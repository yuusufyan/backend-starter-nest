import { readSuperAdminSeedInput } from './superadmin.seed.js';

const valid = {
  SEED_SUPERADMIN_EMAIL: 'admin@example.com',
  SEED_SUPERADMIN_PASSWORD: 'password-panjang-123', // secret-scan:ignore nilai palsu untuk test
};

describe('readSuperAdminSeedInput', () => {
  it('membaca input valid dan memakai nama default', () => {
    expect(readSuperAdminSeedInput(valid)).toEqual({
      email: 'admin@example.com',
      password: 'password-panjang-123', // secret-scan:ignore nilai palsu untuk test
      name: 'Super Admin',
    });
    expect(
      readSuperAdminSeedInput({ ...valid, SEED_SUPERADMIN_NAME: ' Budi ' })
        .name,
    ).toBe('Budi');
  });

  it('wajib diisi: tanpa nilai default untuk email dan password', () => {
    expect(() => readSuperAdminSeedInput({})).toThrow(
      /SEED_SUPERADMIN_EMAIL wajib[\s\S]*SEED_SUPERADMIN_PASSWORD wajib/,
    );
  });

  it.each([
    [
      'email tidak valid',
      { SEED_SUPERADMIN_EMAIL: 'bukan-email' },
      /EMAIL bukan alamat/,
    ],
    [
      'password terlalu pendek',
      { SEED_SUPERADMIN_PASSWORD: 'pendek' },
      /minimal 8/,
    ],
    [
      'password lebih dari 72 byte',
      { SEED_SUPERADMIN_PASSWORD: 'x'.repeat(73) },
      /maksimal 72/,
    ],
  ])('menolak %s', (_nama, override, pesan) => {
    expect(() => readSuperAdminSeedInput({ ...valid, ...override })).toThrow(
      pesan,
    );
  });

  it('pesan error tidak pernah memuat nilai password', () => {
    const rahasia = 'pendek';
    try {
      readSuperAdminSeedInput({ ...valid, SEED_SUPERADMIN_PASSWORD: rahasia });
    } catch (error) {
      expect((error as Error).message).not.toContain(rahasia);
      return;
    }
    throw new Error('seharusnya melempar error');
  });
});
