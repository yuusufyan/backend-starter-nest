import { randomBytes } from 'node:crypto';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { auditColumns } from './audit-columns.js';
import { BaseRepository } from './base.repository.js';

// Tes integrasi: butuh Postgres sungguhan. Jalankan dengan
//   TEST_DATABASE_URL=postgres://user:pass@host:port/db bun run test:int
// Tanpa variabel itu, seluruh suite di-skip. Semua tabel dibuat di schema
// sementara dan dibuang setelah selesai.
const url = process.env.TEST_DATABASE_URL;

const items = pgTable('items', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  note: text(),
  ...auditColumns,
});

class ItemsRepository extends BaseRepository<typeof items> {
  constructor(db: NodePgDatabase) {
    super(db, items, { searchColumns: [items.name, items.note] });
  }
}

describe.skipIf(!url)('BaseRepository (Postgres)', () => {
  const schema = `t_${randomBytes(6).toString('hex')}`;
  let pool: Pool;
  let db: NodePgDatabase;
  let repo: ItemsRepository;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url });
    await admin.query(`create schema "${schema}"`);
    await admin.end();

    pool = new Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
    });
    db = drizzle({ client: pool });
    repo = new ItemsRepository(db);
    await db.execute(sql`
      create table items (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        note text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        created_by text,
        updated_by text,
        deleted_at timestamptz,
        deleted_by text
      )`);
  });

  afterAll(async () => {
    await pool.query(`drop schema "${schema}" cascade`);
    await pool.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table items`);
  });

  it('create mengisi kolom audit', async () => {
    const row = await repo.create({ name: 'Satu' }, 'u1');
    expect(row).toMatchObject({
      name: 'Satu',
      createdBy: 'u1',
      updatedBy: 'u1',
      deletedAt: null,
    });
    expect(await repo.findById(row.id)).toMatchObject({ id: row.id });
  });

  it('update mengubah nilai, updatedBy, dan updatedAt', async () => {
    const row = await repo.create({ name: 'Lama' }, 'u1');
    const updated = await repo.update(row.id, { name: 'Baru' }, 'u2');
    expect(updated).toMatchObject({ name: 'Baru', updatedBy: 'u2' });
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
      row.updatedAt.getTime(),
    );
  });

  it('softDelete menyembunyikan baris dari semua query', async () => {
    const row = await repo.create({ name: 'Hapus saya' }, 'u1');
    expect(await repo.softDelete(row.id, 'u2')).toBe(true);

    expect(await repo.findById(row.id)).toBeUndefined();
    expect((await repo.findAll()).total).toBe(0);
    expect(await repo.update(row.id, { name: 'x' })).toBeUndefined();
    expect(await repo.softDelete(row.id)).toBe(false);

    // Baris tetap ada di tabel (bukan hard delete) dan mencatat siapa yang menghapus.
    const raw = await pool.query('select deleted_by from items where id = $1', [
      row.id,
    ]);
    expect(raw.rows[0]).toMatchObject({ deleted_by: 'u2' });
  });

  it('findAll: paginasi, total, dan limit dibatasi', async () => {
    for (let i = 1; i <= 25; i++) {
      await repo.create({ name: `item-${String(i).padStart(2, '0')}` });
    }
    const page2 = await repo.findAll({
      page: 2,
      limit: 10,
      sortBy: 'name',
      orderBy: 'ASC',
    });
    expect(page2).toMatchObject({
      total: 25,
      page: 2,
      limit: 10,
      totalPages: 3,
    });
    expect(page2.data.map((r) => r.name)).toEqual(
      Array.from(
        { length: 10 },
        (_, i) => `item-${String(i + 11).padStart(2, '0')}`,
      ),
    );

    expect((await repo.findAll({ limit: 100000 })).limit).toBe(100);
  });

  it('findAll: search ILIKE dengan karakter khusus dicari apa adanya', async () => {
    await repo.create({ name: 'Diskon 50% hari ini' });
    await repo.create({ name: 'Diskon 500 rupiah' });
    await repo.create({ name: 'Lain', note: 'catatan BUDI' });

    expect(
      (await repo.findAll({ term: '50%' })).data.map((r) => r.name),
    ).toEqual(['Diskon 50% hari ini']);
    expect((await repo.findAll({ term: 'budi' })).total).toBe(1);
    expect((await repo.findAll({ term: '%' })).total).toBe(1);
  });

  it('findAll: sortBy di luar whitelist diabaikan, bukan diteruskan ke SQL', async () => {
    await repo.create({ name: 'A' });
    const res = await repo.findAll({ sortBy: 'name; drop table items' });
    expect(res.total).toBe(1);
    expect((await repo.findAll()).total).toBe(1);
  });

  it('transaksi: rollback membatalkan create', async () => {
    await expect(
      db.transaction(async (tx) => {
        await repo.create({ name: 'Dalam transaksi' }, 'u1', tx);
        throw new Error('batal');
      }),
    ).rejects.toThrow('batal');
    expect((await repo.findAll()).total).toBe(0);
  });
});
