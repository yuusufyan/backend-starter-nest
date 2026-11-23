import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import type {
  AuthCredentials,
  AuthProfile,
  UsersRepository,
} from '../users/users.repository.js';
import {
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_REFRESH_TOKEN_MESSAGE,
  JWT_ISSUER,
} from './auth.constants.js';
import { AuthService } from './auth.service.js';
import { buildJwtOptions } from './jwt.options.js';
import { hashPassword, verifyPassword } from './password.js';
import { RefreshTokenStore } from './refresh-token.store.js';

// Bungkus verifyPassword agar bisa dipastikan dipanggil, tanpa mengubah perilakunya.
vi.mock('./password.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./password.js')>();
  return { ...original, verifyPassword: vi.fn(original.verifyPassword) };
});

const SECRET = 'a'.repeat(48); // secret-scan:ignore nilai palsu untuk test
const PASSWORD = 'password-benar-123'; // secret-scan:ignore nilai palsu untuk test

describe('AuthService', () => {
  let redis: Redis;
  let store: RefreshTokenStore;
  let service: AuthService;
  let credentials: AuthCredentials;
  const jwt = new JwtService(buildJwtOptions(SECRET));
  const findCredentialsByEmail =
    vi.fn<UsersRepository['findCredentialsByEmail']>();
  const findAuthProfile = vi.fn<UsersRepository['findAuthProfile']>();

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
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    store = new RefreshTokenStore(redis);
    findCredentialsByEmail.mockReset().mockResolvedValue(credentials);
    findAuthProfile.mockReset().mockResolvedValue(credentials);
    vi.mocked(verifyPassword).mockClear();
    service = new AuthService(
      { findCredentialsByEmail, findAuthProfile } as unknown as UsersRepository,
      jwt,
      store,
    );
  });

  afterEach(() => redis.quit());

  describe('login', () => {
    it('berhasil: access token valid, refresh token, dan user tanpa passwordHash', async () => {
      const res = await service.login('Admin@Example.com', PASSWORD);

      expect(findCredentialsByEmail).toHaveBeenCalledWith('Admin@Example.com');
      expect(res).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: 900,
        user: {
          id: 'u1',
          email: 'admin@example.com',
          name: 'Admin',
          role: 'superadmin',
        },
      });
      expect(res.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(JSON.stringify(res)).not.toContain(credentials.passwordHash);
      expect(Object.keys(res.user)).not.toContain('passwordHash');

      const claims = await jwt.verifyAsync<{ sub: string; iss: string }>(
        res.accessToken,
      );
      expect(claims).toMatchObject({ sub: 'u1', iss: JWT_ISSUER });
    });

    it('password salah, email tidak ada, dan user nonaktif: pesan sama persis', async () => {
      const salah = await service
        .login('admin@example.com', 'password-salah')
        .catch((e: unknown) => e);

      findCredentialsByEmail.mockResolvedValueOnce(undefined);
      const takAda = await service
        .login('hantu@example.com', PASSWORD)
        .catch((e: unknown) => e);

      findCredentialsByEmail.mockResolvedValueOnce({
        ...credentials,
        isActive: false,
      });
      const nonaktif = await service
        .login('admin@example.com', PASSWORD)
        .catch((e: unknown) => e);

      for (const err of [salah, takAda, nonaktif]) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        expect((err as UnauthorizedException).message).toBe(
          INVALID_CREDENTIALS_MESSAGE,
        );
      }
    });

    it('email tidak terdaftar tetap menjalankan bcrypt (waktu respons tidak membocorkan email)', async () => {
      findCredentialsByEmail.mockResolvedValueOnce(undefined);
      await expect(
        service.login('hantu@example.com', PASSWORD),
      ).rejects.toThrow(UnauthorizedException);

      expect(verifyPassword).toHaveBeenCalledTimes(1);
      const hashUsed = vi.mocked(verifyPassword).mock.calls[0][1];
      expect(hashUsed).toMatch(/^\$2[aby]\$10\$/);
      expect(hashUsed).not.toBe(credentials.passwordHash);
    });

    it('user nonaktif dengan password benar tetap ditolak, tanpa menerbitkan token', async () => {
      findCredentialsByEmail.mockResolvedValueOnce({
        ...credentials,
        isActive: false,
      });
      await expect(
        service.login('admin@example.com', PASSWORD),
      ).rejects.toThrow(UnauthorizedException);
      expect(await redis.keys('*')).toHaveLength(0);
    });
  });

  describe('refresh', () => {
    it('merotasi refresh token dan menerbitkan access token baru', async () => {
      const login = await service.login('admin@example.com', PASSWORD);
      const next = await service.refresh(login.refreshToken);

      expect(next.refreshToken).not.toBe(login.refreshToken);
      expect(
        (await jwt.verifyAsync<{ sub: string }>(next.accessToken)).sub,
      ).toBe('u1');
      expect(next).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    });

    it('token lama yang dipakai ulang ditolak dan mencabut sesi, termasuk token baru', async () => {
      const login = await service.login('admin@example.com', PASSWORD);
      const next = await service.refresh(login.refreshToken);

      await expect(service.refresh(login.refreshToken)).rejects.toThrow(
        INVALID_REFRESH_TOKEN_MESSAGE,
      );
      await expect(service.refresh(next.refreshToken)).rejects.toThrow(
        INVALID_REFRESH_TOKEN_MESSAGE,
      );
    });

    it('token tidak dikenal ditolak dengan pesan generik', async () => {
      await expect(service.refresh('token-ngawur')).rejects.toThrow(
        INVALID_REFRESH_TOKEN_MESSAGE,
      );
    });

    it('user yang dinonaktifkan sejak login: ditolak dan semua sesinya dicabut', async () => {
      const a = await service.login('admin@example.com', PASSWORD);
      const b = await service.login('admin@example.com', PASSWORD);

      findAuthProfile.mockResolvedValueOnce({
        ...(credentials as AuthProfile),
        isActive: false,
      });
      await expect(service.refresh(a.refreshToken)).rejects.toThrow(
        INVALID_REFRESH_TOKEN_MESSAGE,
      );

      // Sesi lain milik user yang sama ikut mati, walau user sudah aktif lagi.
      await expect(service.refresh(b.refreshToken)).rejects.toThrow(
        INVALID_REFRESH_TOKEN_MESSAGE,
      );
    });
  });

  describe('logout', () => {
    it('mencabut sesi: refresh token tidak bisa dipakai lagi', async () => {
      const login = await service.login('admin@example.com', PASSWORD);
      await service.logout(login.refreshToken, 'u1');
      await expect(service.refresh(login.refreshToken)).rejects.toThrow(
        INVALID_REFRESH_TOKEN_MESSAGE,
      );
    });

    it('idempotent dan tidak bisa mencabut sesi milik orang lain', async () => {
      const login = await service.login('admin@example.com', PASSWORD);

      await expect(service.logout('tidak-ada', 'u1')).resolves.toBeUndefined();
      await expect(
        service.logout(login.refreshToken, 'orang-lain'),
      ).resolves.toBeUndefined();

      // Sesi u1 tetap hidup.
      await expect(service.refresh(login.refreshToken)).resolves.toBeTruthy();
    });
  });
});
