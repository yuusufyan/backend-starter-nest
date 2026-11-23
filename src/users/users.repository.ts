import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  BaseRepository,
  type DbExecutor,
  type Id,
  type Result,
  type Writable,
} from '../database/base.repository.js';
import { roles } from '../roles/roles.schema.js';
import { users } from './users.schema.js';

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

type PublicUser = Result<typeof users, 'passwordHash'>;

/** Identitas yang dipakai autentikasi: user aktif/tidak beserta nama role-nya. */
export interface AuthProfile {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  role: string;
}

/** Hanya untuk login: satu-satunya jalur yang mengembalikan `passwordHash`. */
export type AuthCredentials = AuthProfile & { passwordHash: string };

// User dengan role yang sudah soft delete tidak dianggap punya identitas (fail closed).
const authColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  isActive: users.isActive,
  role: roles.name,
};

/**
 * `passwordHash` (Restricted) di-omit: tidak pernah keluar dari repository ini.
 * Email selalu disimpan dan dicari dalam huruf kecil.
 */
@Injectable()
export class UsersRepository extends BaseRepository<
  typeof users,
  'passwordHash'
> {
  constructor(@InjectDrizzle() db: NodePgDatabase) {
    super(db, users, {
      searchColumns: [users.name, users.email],
      omit: ['passwordHash'],
    });
  }

  override create(
    values: Writable<typeof users>,
    userId?: string,
    tx?: DbExecutor,
  ): Promise<PublicUser> {
    return super.create(
      { ...values, email: normalizeEmail(values.email) },
      userId,
      tx,
    );
  }

  override update(
    id: Id<typeof users>,
    values: Partial<Writable<typeof users>>,
    userId?: string,
    tx?: DbExecutor,
  ): Promise<PublicUser | undefined> {
    return super.update(
      id,
      values.email === undefined
        ? values
        : { ...values, email: normalizeEmail(values.email) },
      userId,
      tx,
    );
  }

  async findAuthProfile(
    id: string,
    tx?: DbExecutor,
  ): Promise<AuthProfile | undefined> {
    const rows = await (tx ?? this.db)
      .select(authColumns)
      .from(users)
      .innerJoin(
        roles,
        and(eq(roles.id, users.roleId), isNull(roles.deletedAt)),
      )
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    return rows[0];
  }

  /**
   * Untuk login saja. `passwordHash` hanya boleh dibandingkan lalu dibuang;
   * jangan pernah meneruskannya ke response atau log.
   */
  async findCredentialsByEmail(
    email: string,
    tx?: DbExecutor,
  ): Promise<AuthCredentials | undefined> {
    const rows = await (tx ?? this.db)
      .select({ ...authColumns, passwordHash: users.passwordHash })
      .from(users)
      .innerJoin(
        roles,
        and(eq(roles.id, users.roleId), isNull(roles.deletedAt)),
      )
      .where(
        and(
          sql`lower(${users.email}) = ${normalizeEmail(email)}`,
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return rows[0];
  }

  findByEmail(email: string, tx?: DbExecutor): Promise<PublicUser | undefined> {
    return this.findOneBy(
      sql`lower(${users.email}) = ${normalizeEmail(email)}`,
      tx,
    );
  }
}
