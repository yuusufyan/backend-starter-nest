import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import {
  createMigratedSchema,
  type MigratedSchema,
} from '../../test/migrated-schema.js';
import { seedSuperAdmin } from '../database/seeds/superadmin.seed.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';

// Alur login lewat AppModule SUNGGUHAN dan Postgres sungguhan (migration asli,
// seeder asli). Hanya Redis yang ditiru (ioredis-mock), jadi cukup Postgres:
//   TEST_DATABASE_URL=postgres://user:pass@host:port/db bun run test:int
const url = process.env.TEST_DATABASE_URL;

const EMAIL = 'root@example.com';
const PASSWORD = 'password-seed-123'; // secret-scan:ignore nilai palsu untuk test

describe.skipIf(!url)('Login end-to-end (AppModule + Postgres)', () => {
  let ctx: MigratedSchema;
  let app: INestApplication;
  const envBackup = { ...process.env };

  beforeAll(async () => {
    ctx = await createMigratedSchema(url!);
    await seedSuperAdmin(ctx.db, {
      email: EMAIL,
      password: PASSWORD,
      name: 'Root',
    });

    // AppModule membaca koneksi dari env: arahkan ke schema sementara ini.
    const db = new URL(url!);
    Object.assign(process.env, {
      NODE_ENV: 'test',
      JWT_SECRET: 'a'.repeat(48), // secret-scan:ignore nilai palsu untuk test
      DB_HOST: db.hostname,
      DB_PORT: db.port || '5432',
      DB_USERNAME: decodeURIComponent(db.username),
      DB_PASSWORD: decodeURIComponent(db.password),
      DB_NAME: db.pathname.slice(1),
      PGOPTIONS: `-c search_path=${ctx.schema}`,
    });

    const { AppModule } = await import('../app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS_CLIENT)
      .useValue(new RedisMock())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await ctx.drop();
    process.env = envBackup;
  });

  const post = (path: string) => request(app.getHttpServer()).post(path);

  it('/health: database dan redis up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.info).toMatchObject({
      database: { status: 'up' },
      redis: { status: 'up' },
    });
  });

  it('alur lengkap: login, me, refresh, logout, dan refresh sesudah logout ditolak', async () => {
    const login = await post('/auth/login')
      .send({ email: 'ROOT@Example.com', password: PASSWORD })
      .expect(200);
    expect(login.body.user).toMatchObject({
      email: EMAIL,
      name: 'Root',
      role: 'superadmin',
    });
    expect(login.text).not.toContain('$2'); // tidak ada hash bcrypt di response

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ email: EMAIL, role: 'superadmin' });

    const refreshed = await post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);

    await post('/auth/logout')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(204);

    await post('/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
  });

  it('password salah dan email tidak dikenal: 401 dengan pesan yang sama', async () => {
    const salah = await post('/auth/login')
      .send({ email: EMAIL, password: 'salah-salah-salah' }) // secret-scan:ignore nilai palsu untuk test
      .expect(401);
    const takAda = await post('/auth/login')
      .send({ email: 'hantu@example.com', password: PASSWORD })
      .expect(401);
    expect(takAda.body).toEqual(salah.body);
  });

  it('user dinonaktifkan di DB: access token yang masih berlaku langsung ditolak', async () => {
    const login = await post('/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    await request(app.getHttpServer()).get('/auth/me').set(auth).expect(200);
    await ctx.pool.query('update users set is_active = false');
    await request(app.getHttpServer()).get('/auth/me').set(auth).expect(401);
    // Login ulang juga ditolak, dan refresh token lama tidak bisa menghidupkan sesi.
    await post('/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(401);
    await post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
    await ctx.pool.query('update users set is_active = true');
  });
});
