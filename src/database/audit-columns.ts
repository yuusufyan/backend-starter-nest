import { text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Kolom audit + soft delete yang dipakai semua tabel domain. Sebarkan ke
 * definisi tabel: `pgTable('users', { id: ..., ...auditColumns })`.
 * `BaseRepository` mensyaratkan tabel memiliki kolom `id` dan semua kolom ini.
 */
export const auditColumns = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: text('deleted_by'),
};

export type AuditColumnKey = keyof typeof auditColumns;
