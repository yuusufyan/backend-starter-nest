import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { buildPoolConfig } from '../database.options.js';
import { readSuperAdminSeedInput, seedSuperAdmin } from './superadmin.seed.js';

// Entry CLI: `bun run seed`. Skrip di luar aplikasi Nest, jadi memakai console.
// Idempotent; jangan dijalankan ke database bersama tanpa instruksi eksplisit.
async function main() {
  const input = readSuperAdminSeedInput(process.env);
  const pool = new Pool(buildPoolConfig());
  try {
    const result = await seedSuperAdmin(drizzle({ client: pool }), input);
    console.log(
      `Seed selesai: role superadmin ${result.roleCreated ? 'dibuat' : 'sudah ada'}, ` +
        `user superadmin ${result.userCreated ? 'dibuat' : 'sudah ada (tidak diubah)'}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed gagal');
  process.exitCode = 1;
});
