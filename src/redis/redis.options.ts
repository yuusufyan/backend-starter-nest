import type { RedisOptions } from 'ioredis';

/**
 * Opsi koneksi Redis dari environment. Perintah dibatasi waktunya dan tidak
 * diulang tanpa batas, supaya Redis yang mati membuat request gagal cepat
 * (bukan menggantung).
 */
export function buildRedisOptions(
  env: Record<string, string | undefined> = process.env,
): RedisOptions {
  return {
    host: env.REDIS_HOST || 'localhost',
    port: Number(env.REDIS_PORT || 6379),
    password: env.REDIS_PASSWORD || undefined,
    db: Number(env.REDIS_DB || 0),
    maxRetriesPerRequest: 1,
    commandTimeout: 2000,
    connectTimeout: 5000,
  };
}
