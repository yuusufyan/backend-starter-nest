import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  BaseRepository,
  type DbExecutor,
  type Id,
  type Result,
  type Writable,
} from '../database/base.repository.js';
import { users } from './users.schema.js';

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

type PublicUser = Result<typeof users, 'passwordHash'>;

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

  findByEmail(email: string, tx?: DbExecutor): Promise<PublicUser | undefined> {
    return this.findOneBy(
      sql`lower(${users.email}) = ${normalizeEmail(email)}`,
      tx,
    );
  }
}
