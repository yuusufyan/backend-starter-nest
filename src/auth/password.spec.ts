import {
  BCRYPT_COST,
  MAX_PASSWORD_BYTES,
  hashPassword,
  verifyPassword,
} from './password.js';

describe('password', () => {
  it('hash memakai bcrypt dengan cost 10 dan salt berbeda tiap kali', async () => {
    const [a, b] = await Promise.all([
      hashPassword('rahasia-123'), // secret-scan:ignore nilai palsu untuk test
      hashPassword('rahasia-123'), // secret-scan:ignore nilai palsu untuk test
    ]);
    expect(a).toMatch(new RegExp(`^\\$2[aby]\\$${BCRYPT_COST}\\$`));
    expect(a).not.toBe(b);
    expect(a).not.toContain('rahasia-123');
  });

  it('verify: benar, salah, dan hash rusak', async () => {
    const hash = await hashPassword('rahasia-123'); // secret-scan:ignore nilai palsu untuk test
    expect(await verifyPassword('rahasia-123', hash)).toBe(true); // secret-scan:ignore nilai palsu untuk test
    expect(await verifyPassword('salah', hash)).toBe(false);
    expect(await verifyPassword('rahasia-123', 'bukan-hash')).toBe(false); // secret-scan:ignore nilai palsu untuk test
  });

  it('menolak password kosong dan melebihi 72 byte (bcrypt memotong diam-diam)', async () => {
    await expect(hashPassword('')).rejects.toThrow();
    await expect(
      hashPassword('a'.repeat(MAX_PASSWORD_BYTES + 1)),
    ).rejects.toThrow();
    // 72 karakter ASCII masih boleh; 37 karakter 2-byte = 74 byte tidak.
    await expect(
      hashPassword('a'.repeat(MAX_PASSWORD_BYTES)),
    ).resolves.toBeTruthy();
    await expect(hashPassword('é'.repeat(37))).rejects.toThrow();
    expect(await verifyPassword('', 'apa-saja')).toBe(false);
  });

  it('dua password yang sama di 72 byte pertama tidak boleh dianggap sama', async () => {
    const hash = await hashPassword('a'.repeat(MAX_PASSWORD_BYTES));
    expect(
      await verifyPassword('a'.repeat(MAX_PASSWORD_BYTES) + 'x', hash),
    ).toBe(false);
  });
});
