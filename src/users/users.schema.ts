import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns } from '../database/audit-columns.js';
import { roles } from '../roles/roles.schema.js';

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    // Confidential. Disimpan huruf kecil (dinormalisasi UsersRepository).
    email: text().notNull(),
    name: text().notNull(),
    // Restricted: hash bcrypt. Tidak pernah dikembalikan repository/response/log.
    passwordHash: text('password_hash').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns,
  },
  (t) => [
    // Email unik hanya di antara user yang belum soft delete, tanpa membedakan huruf.
    uniqueIndex('users_email_active_uq')
      .on(sql`lower(${t.email})`)
      .where(sql`${t.deletedAt} is null`),
    index('users_role_id_idx').on(t.roleId),
  ],
);
