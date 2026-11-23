import type { PoolConfig } from 'pg';

/**
 * Satu sumber konfigurasi koneksi untuk aplikasi (DatabaseModule) dan CLI
 * migration (drizzle.config.ts), supaya keduanya tidak pernah melenceng.
 * Skema hanya berubah lewat migration (drizzle-kit), tidak pernah otomatis.
 */
export function buildPoolConfig(
  env: Record<string, string | undefined> = process.env,
): PoolConfig {
  return {
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? 5432),
    user: env.DB_USERNAME ?? 'postgres',
    password: env.DB_PASSWORD,
    database: env.DB_NAME ?? 'backend_starter',
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}
