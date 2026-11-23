import {
  createMigratedSchema,
  type MigratedSchema,
} from '../../../test/migrated-schema.js';
import { verifyPassword } from '../../auth/password.js';
import { seedSuperAdmin } from './superadmin.seed.js';

// Tes integrasi: lihat petunjuk TEST_DATABASE_URL di users.repository.int.spec.ts.
const url = process.env.TEST_DATABASE_URL;

const input = {
  email: 'Root@Example.com',
  password: 'password-awal-123', // secret-scan:ignore nilai palsu untuk test
  name: 'Root',
};

describe.skipIf(!url)('seedSuperAdmin (Postgres)', () => {
  let ctx: MigratedSchema;

  beforeAll(async () => {
    ctx = await createMigratedSchema(url!);
  });

  afterAll(async () => {
    await ctx.drop();
  });

  beforeEach(async () => {
    await ctx.pool.query('truncate table users, roles cascade');
  });

  const hashes = async () =>
    (await ctx.pool.query('select password_hash from users')).rows.map(
      (r) => r.password_hash as string,
    );

  it('membuat role superadmin dan user superadmin dengan password ter-hash', async () => {
    expect(await seedSuperAdmin(ctx.db, input)).toEqual({
      roleCreated: true,
      userCreated: true,
    });

    const { rows } = await ctx.pool.query(
      `select u.email, u.name, u.is_active, r.name as role
         from users u join roles r on r.id = u.role_id`,
    );
    expect(rows).toEqual([
      {
        email: 'root@example.com',
        name: 'Root',
        is_active: true,
        role: 'superadmin',
      },
    ]);

    const [hash] = await hashes();
    expect(hash).not.toContain(input.password);
    expect(await verifyPassword(input.password, hash)).toBe(true);
  });

  it('idempotent: dijalankan ulang tidak menggandakan dan tidak mengganti password', async () => {
    await seedSuperAdmin(ctx.db, input);
    const [before] = await hashes();

    const again = await seedSuperAdmin(ctx.db, {
      ...input,
      email: 'ROOT@example.com',
      password: 'password-lain-456', // secret-scan:ignore nilai palsu untuk test
    });
    expect(again).toEqual({ roleCreated: false, userCreated: false });

    const counts = await ctx.pool.query(
      `select (select count(*) from users)::int as users,
              (select count(*) from roles)::int as roles`,
    );
    expect(counts.rows[0]).toEqual({ users: 1, roles: 1 });
    expect(await hashes()).toEqual([before]);
  });

  it('role yang sudah ada dipakai ulang untuk user baru', async () => {
    await seedSuperAdmin(ctx.db, input);
    const result = await seedSuperAdmin(ctx.db, {
      ...input,
      email: 'kedua@example.com',
    });
    expect(result).toEqual({ roleCreated: false, userCreated: true });
    expect(
      (await ctx.pool.query('select count(*)::int as n from roles')).rows[0].n,
    ).toBe(1);
  });
});
