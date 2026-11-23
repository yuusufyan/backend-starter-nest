import {
  createMigratedSchema,
  type MigratedSchema,
} from '../../test/migrated-schema.js';
import { RoleName } from '../roles/role.constants.js';
import { RolesRepository } from '../roles/roles.repository.js';
import { UsersRepository } from './users.repository.js';

// Tes integrasi (Postgres sungguhan + migration asli). Jalankan dengan
//   TEST_DATABASE_URL=postgres://user:pass@host:port/db bun run test:int
const url = process.env.TEST_DATABASE_URL;

// Drizzle membungkus error driver; kode SQLSTATE ada di `cause`.
const pgCode = (error: unknown): string | undefined => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
};

describe.skipIf(!url)('Roles & Users (Postgres)', () => {
  let ctx: MigratedSchema;
  let roles: RolesRepository;
  let users: UsersRepository;
  let roleId: string;

  beforeAll(async () => {
    ctx = await createMigratedSchema(url!);
    roles = new RolesRepository(ctx.db);
    users = new UsersRepository(ctx.db);
  });

  afterAll(async () => {
    await ctx.drop();
  });

  beforeEach(async () => {
    await ctx.pool.query('truncate table users, roles cascade');
    roleId = (await roles.create({ name: RoleName.SuperAdmin })).id;
  });

  const newUser = (
    overrides: Partial<{ email: string; name: string }> = {},
  ) => ({
    email: 'Admin@Example.com',
    name: 'Admin',
    passwordHash: 'hash-palsu', // secret-scan:ignore nilai palsu untuk test
    roleId,
    ...overrides,
  });

  it('role: findByName, dan nama unik di antara role yang aktif', async () => {
    expect(await roles.findByName(RoleName.SuperAdmin)).toMatchObject({
      id: roleId,
    });
    expect(await roles.findByName('tidak-ada')).toBeUndefined();

    await expect(roles.create({ name: RoleName.SuperAdmin })).rejects.toSatisfy(
      (e) => pgCode(e) === '23505',
    );

    // Setelah soft delete, nama itu boleh dipakai lagi.
    await roles.softDelete(roleId);
    expect(await roles.findByName(RoleName.SuperAdmin)).toBeUndefined();
    await expect(
      roles.create({ name: RoleName.SuperAdmin }),
    ).resolves.toBeTruthy();
  });

  it('user: email disimpan huruf kecil dan dicari tanpa membedakan huruf', async () => {
    const created = await users.create(newUser(), 'sistem');
    expect(created).toMatchObject({
      email: 'admin@example.com',
      createdBy: 'sistem',
    });

    expect(await users.findByEmail('ADMIN@example.COM')).toMatchObject({
      id: created.id,
    });
    expect(await users.findByEmail('  admin@example.com ')).toMatchObject({
      id: created.id,
    });
    expect(await users.findByEmail('lain@example.com')).toBeUndefined();
  });

  it('user: passwordHash tersimpan di DB tetapi tidak pernah keluar dari repository', async () => {
    const created = await users.create(newUser());
    const updated = await users.update(created.id, { name: 'Admin Baru' });
    const byId = await users.findById(created.id);
    const byEmail = await users.findByEmail('admin@example.com');
    const list = await users.findAll({ term: 'admin' });

    for (const row of [created, updated, byId, byEmail, ...list.data]) {
      expect(row).toBeDefined();
      expect(Object.keys(row!)).not.toContain('passwordHash');
      expect(JSON.stringify(row)).not.toContain('hash-palsu');
    }
    expect(list.total).toBe(1);

    const raw = await ctx.pool.query('select password_hash from users');
    expect(raw.rows[0].password_hash).toBe('hash-palsu');
  });

  it('user: sortBy passwordHash tidak dikenali (tidak bisa dipakai mengurutkan)', async () => {
    await users.create(newUser({ email: 'a@x.id' }));
    await users.create(newUser({ email: 'b@x.id' }));
    const res = await users.findAll({ sortBy: 'passwordHash', orderBy: 'ASC' });
    expect(res.total).toBe(2);
  });

  it('user: email unik di antara user aktif; setelah soft delete boleh dipakai lagi', async () => {
    const first = await users.create(newUser());

    await expect(
      users.create(newUser({ email: 'ADMIN@example.com' })),
    ).rejects.toSatisfy((e) => pgCode(e) === '23505');

    await users.softDelete(first.id, 'sistem');
    expect(await users.findByEmail('admin@example.com')).toBeUndefined();
    await expect(users.create(newUser())).resolves.toBeTruthy();
  });

  it('FK: user wajib punya role yang ada, dan role yang dipakai tidak bisa dihapus permanen', async () => {
    await expect(
      users.create({
        ...newUser(),
        roleId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toSatisfy((e) => pgCode(e) === '23503');

    await users.create(newUser());
    await expect(ctx.pool.query('delete from roles')).rejects.toMatchObject({
      code: '23503',
    });
  });

  describe('identitas untuk autentikasi', () => {
    it('findCredentialsByEmail: satu-satunya jalur yang membawa passwordHash, lengkap dengan nama role', async () => {
      const created = await users.create(newUser());

      const credentials = await users.findCredentialsByEmail(
        '  ADMIN@example.com ',
      );
      expect(credentials).toEqual({
        id: created.id,
        email: 'admin@example.com',
        name: 'Admin',
        isActive: true,
        role: RoleName.SuperAdmin,
        passwordHash: 'hash-palsu', // secret-scan:ignore nilai palsu untuk test
      });
      expect(
        await users.findCredentialsByEmail('lain@example.com'), // secret-scan:ignore email palsu untuk test
      ).toBeUndefined();
    });

    it('findAuthProfile: tanpa passwordHash, dengan status aktif', async () => {
      const created = await users.create(newUser());
      await users.update(created.id, { isActive: false });

      const profile = await users.findAuthProfile(created.id);
      expect(profile).toEqual({
        id: created.id,
        email: 'admin@example.com',
        name: 'Admin',
        isActive: false,
        role: RoleName.SuperAdmin,
      });
      expect(Object.keys(profile!)).not.toContain('passwordHash');
      expect(
        await users.findAuthProfile('00000000-0000-0000-0000-000000000000'),
      ).toBeUndefined();
    });

    it('user yang sudah soft delete tidak punya identitas', async () => {
      const created = await users.create(newUser());
      await users.softDelete(created.id);

      expect(await users.findAuthProfile(created.id)).toBeUndefined();
      expect(
        await users.findCredentialsByEmail('admin@example.com'), // secret-scan:ignore email palsu untuk test
      ).toBeUndefined();
    });

    it('user dengan role yang sudah soft delete tidak punya identitas (fail closed)', async () => {
      const created = await users.create(newUser());
      await roles.softDelete(roleId);

      expect(await users.findAuthProfile(created.id)).toBeUndefined();
      expect(
        await users.findCredentialsByEmail('admin@example.com'), // secret-scan:ignore email palsu untuk test
      ).toBeUndefined();
    });
  });
});
