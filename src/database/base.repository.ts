import {
  and,
  asc,
  count,
  desc,
  eq,
  getColumns,
  ilike,
  isNull,
  or,
  type InferInsertModel,
  type InferSelectModel,
  type SQL,
} from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { AuditColumnKey } from './audit-columns.js';
import {
  escapeLike,
  normalizePagination,
  type ListQuery,
  type Page,
} from './list-query.js';

/** Tabel yang boleh dipakai: punya `id` dan semua kolom dari `auditColumns`. */
export type AuditedTable = PgTable & Record<'id' | AuditColumnKey, AnyPgColumn>;

export type Row<T extends AuditedTable> = InferSelectModel<T>;
export type Id<T extends AuditedTable> = T['id']['_']['data'];
/** Nilai yang boleh ditulis pemanggil; kolom audit diisi repository. */
export type Writable<T extends AuditedTable> = Omit<
  InferInsertModel<T>,
  AuditColumnKey
>;

/** `db` biasa atau transaksi (`db.transaction(async (tx) => ...)`). */
export type DbExecutor = Pick<
  NodePgDatabase,
  'select' | 'insert' | 'update' | 'delete'
>;

/** Baris yang dikembalikan repository: `Row<T>` tanpa kolom yang di-`omit`. */
export type Result<
  T extends AuditedTable,
  TOmit extends keyof Row<T> = never,
> = Omit<Row<T>, TOmit>;

export interface RepositoryOptions<TOmit extends PropertyKey = never> {
  /** Kolom teks yang dicari lewat `term` (ILIKE). Kosong = pencarian dimatikan. */
  searchColumns?: AnyPgColumn[];
  /**
   * Kolom yang tidak pernah dikembalikan (mis. `passwordHash`): dibuang dari
   * SELECT/RETURNING dan tidak bisa dipakai di `sortBy`. Menulis ke kolom itu
   * tetap diizinkan lewat `create`/`update`.
   */
  omit?: readonly TOmit[];
}

/**
 * Operasi CRUD generik di atas satu tabel Drizzle: paginasi (limit dibatasi),
 * sort dan search ber-whitelist, soft delete, dan pengisian kolom audit.
 *
 * Pakai dengan extend, lalu tambahkan query khusus domain di subclass:
 *
 *   @Injectable()
 *   export class UsersRepository extends BaseRepository<typeof users> {
 *     constructor(@InjectDrizzle() db: NodePgDatabase) {
 *       super(db, users, { searchColumns: [users.name, users.email] });
 *     }
 *   }
 *
 * Semua method mengabaikan baris yang sudah soft delete. Untuk beberapa tulis
 * dalam satu transaksi, kirim `tx` sebagai argumen terakhir.
 */
export class BaseRepository<
  T extends AuditedTable,
  TOmit extends keyof Row<T> = never,
> {
  // Generik Drizzle tidak bisa dipersempit sampai ke tipe hasil query, jadi
  // query dibangun di atas `PgTable` biasa dan hasilnya di-cast ke `Result`.
  private readonly t: PgTable;
  // Kolom yang boleh keluar (semua kolom tabel dikurangi `omit`).
  private readonly columns: Record<string, AnyPgColumn>;

  constructor(
    protected readonly db: NodePgDatabase,
    protected readonly table: T,
    private readonly options: RepositoryOptions<TOmit> = {},
  ) {
    this.t = table;
    const hidden = new Set<PropertyKey>(options.omit ?? []);
    this.columns = Object.fromEntries(
      Object.entries(getColumns(table)).filter(([key]) => !hidden.has(key)),
    ) as Record<string, AnyPgColumn>;
  }

  async findAll(
    query: ListQuery = {},
    extraWhere?: SQL,
    tx?: DbExecutor,
  ): Promise<Page<Result<T, TOmit>>> {
    const exec = tx ?? this.db;
    const { page, limit, offset } = normalizePagination(query);
    const where = and(
      isNull(this.table.deletedAt),
      extraWhere,
      this.searchCondition(query.term),
    );

    const [rows, totals] = await Promise.all([
      exec
        .select(this.columns)
        .from(this.t)
        .where(where)
        .orderBy(...this.orderBy(query))
        .limit(limit)
        .offset(offset),
      exec.select({ total: count() }).from(this.t).where(where),
    ]);

    const total = Number(totals[0]?.total ?? 0);
    return {
      data: rows as Result<T, TOmit>[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(
    id: Id<T>,
    tx?: DbExecutor,
  ): Promise<Result<T, TOmit> | undefined> {
    const rows = await (tx ?? this.db)
      .select(this.columns)
      .from(this.t)
      .where(this.alive(id))
      .limit(1);
    return rows[0] as Result<T, TOmit> | undefined;
  }

  async create(
    values: Writable<T>,
    userId?: string,
    tx?: DbExecutor,
  ): Promise<Result<T, TOmit>> {
    const rows = await (tx ?? this.db)
      .insert(this.t)
      .values({ ...values, createdBy: userId, updatedBy: userId })
      .returning(this.columns);
    return rows[0] as Result<T, TOmit>;
  }

  async update(
    id: Id<T>,
    values: Partial<Writable<T>>,
    userId?: string,
    tx?: DbExecutor,
  ): Promise<Result<T, TOmit> | undefined> {
    const rows = await (tx ?? this.db)
      .update(this.t)
      .set({ ...values, updatedBy: userId })
      .where(this.alive(id))
      .returning(this.columns);
    return rows[0] as Result<T, TOmit> | undefined;
  }

  /** Soft delete. Mengembalikan `false` bila baris tidak ada / sudah terhapus. */
  async softDelete(
    id: Id<T>,
    userId?: string,
    tx?: DbExecutor,
  ): Promise<boolean> {
    const rows = await (tx ?? this.db)
      .update(this.t)
      .set({ deletedAt: new Date(), deletedBy: userId, updatedBy: userId })
      .where(this.alive(id))
      .returning({ id: this.table.id });
    return rows.length > 0;
  }

  /**
   * Untuk subclass: satu baris yang cocok dengan `where` (belum soft delete),
   * dengan kolom yang sama seperti method lain (kolom `omit` tetap tersembunyi).
   */
  protected async findOneBy(
    where: SQL,
    tx?: DbExecutor,
  ): Promise<Result<T, TOmit> | undefined> {
    const rows = await (tx ?? this.db)
      .select(this.columns)
      .from(this.t)
      .where(and(where, isNull(this.table.deletedAt)))
      .limit(1);
    return rows[0] as Result<T, TOmit> | undefined;
  }

  /** Baris dengan `id` tertentu yang belum soft delete. */
  private alive(id: Id<T>): SQL | undefined {
    return and(eq(this.table.id, id), isNull(this.table.deletedAt));
  }

  private searchCondition(term?: string): SQL | undefined {
    const columns = this.options.searchColumns ?? [];
    const trimmed = term?.trim();
    if (!trimmed || columns.length === 0) return undefined;
    const pattern = `%${escapeLike(trimmed)}%`;
    return or(...columns.map((column) => ilike(column, pattern)));
  }

  // `sortBy` hanya diterima bila nama kolom milik tabel ini (whitelist);
  // selain itu jatuh ke createdAt terbaru. `id` jadi tie-breaker supaya
  // urutan antar halaman stabil.
  private orderBy(query: ListQuery): SQL[] {
    const sortable = query.sortBy
      ? Object.hasOwn(this.columns, query.sortBy)
        ? this.columns[query.sortBy]
        : undefined
      : undefined;
    const column = sortable ?? this.table.createdAt;
    const direction = sortable ? (query.orderBy === 'DESC' ? desc : asc) : desc;
    return [direction(column), asc(this.table.id)];
  }
}
