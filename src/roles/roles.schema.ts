import { sql } from 'drizzle-orm';
import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from '../database/audit-columns.js';

export const roles = pgTable(
  'roles',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    description: text(),
    ...auditColumns,
  },
  (t) => [
    // Nama role unik hanya di antara role yang belum soft delete.
    uniqueIndex('roles_name_active_uq')
      .on(t.name)
      .where(sql`${t.deletedAt} is null`),
  ],
);
