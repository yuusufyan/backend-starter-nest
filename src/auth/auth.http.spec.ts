import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { createValidationPipe } from '../common/pipes/validation.pipe.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import {
  type AuthCredentials,
  UsersRepository,
} from '../users/users.repository.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { buildJwtOptions } from './jwt.options.js';
import { hashPassword } from './password.js';
import { RefreshTokenStore } from './refresh-token.store.js';

const SECRET = 'a'.repeat(48); // secret-scan:ignore nilai palsu untuk test
const PASSWORD = 'password-benar-123'; // secret-scan:ignore nilai palsu untuk test

// Pengujian lewat HTTP: pipe validasi, filter error, throttler, dan guard
// dirangkai seperti di aplikasi sungguhan; hanya DB dan Redis yang ditiru.
describe('Auth (HTTP)', () => {
  let app: INestApplication;
  let credentials: AuthCredentials;

  const users = {
    findCredentialsByEmail: vi.fn(),
    findAuthProfile: vi.fn(),
  };

  async function createApp() {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }],
        }),
        JwtModule.register(buildJwtOptions(SECRET)),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        RefreshTokenStore,
        JwtAuthGuard,
        { provide: UsersRepository, useValue: users },
        { provide: REDIS_CLIENT, useValue: new RedisMock() },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_PIPE, useFactory: createValidationPipe },
      ],
    }).compile();
    const instance = moduleRef.createNestApplication();
    await instance.init();
    return instance;
  }

  const login = (
    body: object = { email: 'admin@example.com', password: PASSWORD },
  ) => request(app.getHttpServer()).post('/auth/login').send(body);

  beforeAll(async () => {
    credentials = {
      id: 'u1',
      email: 'admin@example.com',
      name: 'Admin',
      isActive: true,
      role: 'superadmin',
      passwordHash: await hashPassword(PASSWORD),
    };
  });

  beforeEach(async () => {
    users.findCredentialsByEmail.mockReset().mockResolvedValue(credentials);
    users.findAuthProfile.mockReset().mockResolvedValue(credentials);
    app = await createApp();
  });

  afterEach(() => app.close());

  describe('POST /auth/login', () => {
    it('200 dengan token dan user; hash password tidak pernah ada di response', async () => {
      const res = await login().expect(200);

      expect(res.body).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: 900,
        user: { id: 'u1', email: 'admin@example.com', role: 'superadmin' },
      });
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toEqual(expect.any(String));
      expect(res.text).not.toContain(credentials.passwordHash);
      expect(res.text).not.toContain('passwordHash');
    });

    it('401 dengan pesan generik yang sama untuk password salah dan email tak dikenal', async () => {
      const salah = await login({
        email: 'admin@example.com',
        password: 'salah-salah-salah', // secret-scan:ignore nilai palsu untuk test
      }).expect(401);

      users.findCredentialsByEmail.mockResolvedValueOnce(undefined);
      const takAda = await login({
        email: 'hantu@example.com',
        password: PASSWORD,
      }).expect(401);

      expect(salah.body).toEqual({
        code: 401,
        status: 'error',
        message: 'Email atau password salah',
        data: 'Unauthorized', // nama error HTTP, sesuai kontrak AllExceptionsFilter
      });
      expect(takAda.body).toEqual(salah.body);
    });

    it.each([
      ['email bukan email', { email: 'bukan-email', password: PASSWORD }],
      ['password kosong', { email: 'admin@example.com', password: '' }],
      [
        'password lebih dari 72 karakter',
        { email: 'admin@example.com', password: 'x'.repeat(73) },
      ],
      [
        'properti di luar DTO',
        { email: 'admin@example.com', password: PASSWORD, role: 'superadmin' },
      ],
      ['tanpa body', {}],
    ])('400 untuk %s, dan DB tidak disentuh', async (_nama, body) => {
      const res = await login(body).expect(400);
      expect(res.body).toMatchObject({ code: 400, status: 'error' });
      expect(users.findCredentialsByEmail).not.toHaveBeenCalled();
    });

    it('429 setelah 5 percobaan per menit (anti tebak password)', async () => {
      const wrong = {
        email: 'admin@example.com',
        password: 'salah-salah-salah', // secret-scan:ignore nilai palsu untuk test
      };
      for (let i = 0; i < 5; i++) await login(wrong).expect(401);
      await login(wrong).expect(429);
      // Yang benar pun tertahan: batasnya per IP, bukan per hasil.
      await login().expect(429);
    });
  });

  describe('GET /auth/me', () => {
    it('401 tanpa token atau dengan token ngawur', async () => {
      const server = app.getHttpServer();
      await request(server).get('/auth/me').expect(401);
      await request(server)
        .get('/auth/me')
        .set('Authorization', 'Bearer token.ngawur.sekali')
        .expect(401);
    });

    it('200 dengan access token valid', async () => {
      const { accessToken } = (await login().expect(200)).body;
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toEqual({
        id: 'u1',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'superadmin',
      });
    });

    it('401 begitu user dinonaktifkan, walau access token belum kedaluwarsa', async () => {
      const { accessToken } = (await login().expect(200)).body;
      users.findAuthProfile.mockResolvedValue({
        ...credentials,
        isActive: false,
      });

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('merotasi token; token lama tidak bisa dipakai lagi dan pemakaian ulangnya mencabut sesi', async () => {
      const server = app.getHttpServer();
      const first = (await login().expect(200)).body;

      const second = (
        await request(server)
          .post('/auth/refresh')
          .send({ refreshToken: first.refreshToken })
          .expect(200)
      ).body;
      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.accessToken).toEqual(expect.any(String));

      // Pemakaian ulang token lama: ditolak, dan token baru ikut dicabut.
      await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: second.refreshToken })
        .expect(401);
    });

    it('400 tanpa refreshToken, 401 untuk token tidak dikenal', async () => {
      const server = app.getHttpServer();
      await request(server).post('/auth/refresh').send({}).expect(400);
      const res = await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: 'tidak-dikenal' })
        .expect(401);
      expect(res.body.message).toBe('Refresh token tidak valid');
    });
  });

  describe('POST /auth/logout', () => {
    it('401 tanpa access token', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: 'apa-saja' })
        .expect(401);
    });

    it('204 dan refresh token tidak berlaku lagi', async () => {
      const server = app.getHttpServer();
      const { accessToken, refreshToken } = (await login().expect(200)).body;

      await request(server)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(204);

      await request(server)
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });
});
