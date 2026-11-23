import { MIN_JWT_SECRET_LENGTH, validateEnv } from './env.validation.js';

const secret = 'x'.repeat(MIN_JWT_SECRET_LENGTH); // secret-scan:ignore nilai palsu untuk test

describe('validateEnv', () => {
  it('menerima konfigurasi valid dan mengembalikannya apa adanya', () => {
    const env = { JWT_SECRET: secret, REDIS_PORT: '6379', DB_PORT: '5432' };
    expect(validateEnv(env)).toBe(env);
  });

  it('JWT_SECRET wajib, tanpa default', () => {
    expect(() => validateEnv({})).toThrow(/JWT_SECRET wajib diisi/);
    expect(() => validateEnv({ JWT_SECRET: '' })).toThrow(/JWT_SECRET wajib/);
  });

  it('JWT_SECRET pendek ditolak tanpa menampilkan nilainya', () => {
    const pendek = 'rahasia-pendek'; // secret-scan:ignore nilai palsu untuk test
    try {
      validateEnv({ JWT_SECRET: pendek });
    } catch (error) {
      expect((error as Error).message).toMatch(/minimal 32 karakter/);
      expect((error as Error).message).not.toContain(pendek);
      return;
    }
    throw new Error('seharusnya melempar error');
  });

  it.each(['abc', '-1', '1.5', '65 536'])(
    'port tidak numerik ditolak: %s',
    (port) => {
      expect(() =>
        validateEnv({ JWT_SECRET: secret, REDIS_PORT: port }),
      ).toThrow(/REDIS_PORT harus berupa bilangan bulat/);
    },
  );

  it('nilai kosong/tidak diset untuk variabel numerik diabaikan (memakai default)', () => {
    expect(() =>
      validateEnv({ JWT_SECRET: secret, REDIS_PORT: '' }),
    ).not.toThrow();
  });
});
