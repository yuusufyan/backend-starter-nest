import { randomBytes } from 'node:crypto';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

export interface MigratedSchema {
  pool: Pool;
  db: NodePgDatabase;
  schema: string;
  drop(): Promise<void>;
}

/**
 * Untuk test integrasi: membuat schema Postgres sementara lalu menerapkan
 * migration asli proyek (src/database/migrations) ke dalamnya, jadi test
 * sekaligus memverifikasi migration. `drop()` membuang schema beserta isinya.
 */
export async function createMigratedSchema(
  url: string,
): Promise<MigratedSchema> {
  const schema = `t_${randomBytes(6).toString('hex')}`;

  const admin = new Pool({ connectionString: url });
  await admin.query(`create schema "${schema}"`);
  await admin.end();

  const pool = new Pool({
    connectionString: url,
    options: `-c search_path=${schema}`,
  });
  const db = drizzle({ client: pool });
  await migrate(db, {
    migrationsFolder: 'src/database/migrations',
    migrationsSchema: schema,
  });

  return {
    pool,
    db,
    schema,
    async drop() {
      await pool.query(`drop schema "${schema}" cascade`);
      await pool.end();
    },
  };
}
