export const MIN_JWT_SECRET_LENGTH = 32;

const NUMERIC_KEYS = ['DB_PORT', 'REDIS_PORT', 'REDIS_DB', 'PORT'] as const;

/**
 * Validasi environment saat boot (dipasang di `ConfigModule.forRoot`). Aplikasi
 * berhenti dengan pesan jelas alih-alih jalan dalam keadaan setengah benar.
 * Pesan hanya menyebut nama variabel, tidak pernah nilainya.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const problems: string[] = [];

  const secret = typeof config.JWT_SECRET === 'string' ? config.JWT_SECRET : '';
  if (!secret) {
    problems.push('JWT_SECRET wajib diisi');
  } else if (secret.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_SECRET minimal ${MIN_JWT_SECRET_LENGTH} karakter`);
  }

  for (const key of NUMERIC_KEYS) {
    const value = config[key];
    if (value === undefined || value === '') continue;
    if (!/^\d+$/.test(String(value))) {
      problems.push(`${key} harus berupa bilangan bulat tidak negatif`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Konfigurasi environment tidak valid:\n- ${problems.join('\n- ')}`,
    );
  }
  return config;
}
