import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { hashPassword, MAX_PASSWORD_BYTES } from '../../auth/password.js';
import { RoleName } from '../../roles/role.constants.js';
import { RolesRepository } from '../../roles/roles.repository.js';
import { UsersRepository } from '../../users/users.repository.js';

export interface SuperAdminSeedInput {
  email: string;
  password: string;
  name: string;
}

export interface SuperAdminSeedResult {
  roleCreated: boolean;
  userCreated: boolean;
}

export const MIN_SEED_PASSWORD_LENGTH = 8;
const DEFAULT_NAME = 'Super Admin';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Membaca dan memvalidasi kredensial seed dari environment. Tanpa nilai
 * default untuk email/password. Pesan error hanya menyebut nama variabel,
 * tidak pernah nilainya.
 */
export function readSuperAdminSeedInput(
  env: Record<string, string | undefined>,
): SuperAdminSeedInput {
  const email = env.SEED_SUPERADMIN_EMAIL?.trim() ?? '';
  const password = env.SEED_SUPERADMIN_PASSWORD ?? '';
  const name = env.SEED_SUPERADMIN_NAME?.trim() || DEFAULT_NAME;

  const problems: string[] = [];
  if (!email) {
    problems.push('SEED_SUPERADMIN_EMAIL wajib diisi');
  } else if (!EMAIL_PATTERN.test(email)) {
    problems.push('SEED_SUPERADMIN_EMAIL bukan alamat email yang valid');
  }
  if (!password) {
    problems.push('SEED_SUPERADMIN_PASSWORD wajib diisi');
  } else if (password.length < MIN_SEED_PASSWORD_LENGTH) {
    problems.push(
      `SEED_SUPERADMIN_PASSWORD minimal ${MIN_SEED_PASSWORD_LENGTH} karakter`,
    );
  } else if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    problems.push(
      `SEED_SUPERADMIN_PASSWORD maksimal ${MAX_PASSWORD_BYTES} byte`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Konfigurasi seed tidak valid:\n- ${problems.join('\n- ')}`,
    );
  }
  return { email, password, name };
}

/**
 * Membuat role `superadmin` dan satu user superadmin. Idempotent: yang sudah
 * ada tidak diubah. Khususnya, menjalankan ulang tidak pernah mengganti
 * password user yang sudah ada. Semuanya dalam satu transaksi.
 */
export async function seedSuperAdmin(
  db: NodePgDatabase,
  input: SuperAdminSeedInput,
): Promise<SuperAdminSeedResult> {
  const roles = new RolesRepository(db);
  const users = new UsersRepository(db);

  // Hash di luar transaksi: bcrypt lambat dan tidak perlu menahan koneksi.
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    let role = await roles.findByName(RoleName.SuperAdmin, tx);
    const roleCreated = !role;
    role ??= await roles.create(
      {
        name: RoleName.SuperAdmin,
        description: 'Akses penuh ke seluruh sistem',
      },
      undefined,
      tx,
    );

    const existing = await users.findByEmail(input.email, tx);
    if (existing) return { roleCreated, userCreated: false };

    await users.create(
      {
        email: input.email,
        name: input.name,
        passwordHash,
        roleId: role.id,
        isActive: true,
      },
      undefined,
      tx,
    );
    return { roleCreated, userCreated: true };
  });
}
