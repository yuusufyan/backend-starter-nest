import bcrypt from 'bcryptjs';

/** Cost bcrypt (keputusan pemilik repo: 10). Naikkan lewat PR tersendiri. */
export const BCRYPT_COST = 10;

/** bcrypt hanya memakai 72 byte pertama; lebih dari itu diam-diam terpotong. */
export const MAX_PASSWORD_BYTES = 72;

function assertUsable(plain: string): void {
  if (plain.length === 0) {
    throw new Error('Password tidak boleh kosong');
  }
  if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error(`Password maksimal ${MAX_PASSWORD_BYTES} byte`);
  }
}

// `async` supaya password tidak valid selalu menjadi promise yang ditolak,
// bukan exception sinkron.
export async function hashPassword(plain: string): Promise<string> {
  assertUsable(plain);
  return bcrypt.hash(plain, BCRYPT_COST);
}

/** `false` untuk password salah, hash rusak, atau password di luar batas. */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  if (
    plain.length === 0 ||
    Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES
  ) {
    return false;
  }
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
