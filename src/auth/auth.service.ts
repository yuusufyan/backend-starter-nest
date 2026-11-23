import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersRepository } from '../users/users.repository.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_REFRESH_TOKEN_MESSAGE,
} from './auth.constants.js';
import type { AuthUser } from './interfaces/auth-user.interface.js';
import { hashPassword, verifyPassword } from './password.js';
import { RefreshTokenStore } from './refresh-token.store.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Umur access token dalam detik. */
  expiresIn: number;
}

export interface LoginResponse extends TokenPair {
  user: AuthUser;
}

// Hash pembanding saat email tidak terdaftar, supaya login selalu memakan
// waktu bcrypt yang sama. Dihitung sekali, saat pertama dibutuhkan.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () =>
  (dummyHash ??= hashPassword('bukan-password-sungguhan')); // secret-scan:ignore bukan secret: pembanding agar waktu bcrypt sama

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenStore,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const credentials = await this.users.findCredentialsByEmail(email);

    // Hash selalu dibandingkan, juga untuk email yang tidak terdaftar, dan semua
    // kegagalan memberi pesan yang sama: tidak ada petunjuk email mana yang ada.
    const passwordOk = await verifyPassword(
      password,
      credentials?.passwordHash ?? (await getDummyHash()),
    );
    if (!credentials || !passwordOk || !credentials.isActive) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const { refreshToken } = await this.refreshTokens.issue(credentials.id);
    return {
      ...(await this.withAccessToken(credentials.id, refreshToken)),
      user: {
        id: credentials.id,
        email: credentials.email,
        name: credentials.name,
        role: credentials.role,
      },
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const result = await this.refreshTokens.rotate(refreshToken);

    if (result.status === 'reused') {
      this.logger.warn(
        `Refresh token terpakai dipakai lagi: sesi ${result.familyId} milik user ${result.userId} dicabut`,
      );
    }
    if (result.status !== 'ok') {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    // User bisa saja dinonaktifkan/dihapus sejak login: semua sesinya dicabut.
    const profile = await this.users.findAuthProfile(result.userId);
    if (!profile?.isActive) {
      await this.refreshTokens.revokeAllForUser(result.userId);
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }
    return this.withAccessToken(result.userId, result.refreshToken);
  }

  /** Idempotent: token yang tidak ada atau bukan milik user diabaikan tanpa error. */
  async logout(refreshToken: string, userId: string): Promise<void> {
    await this.refreshTokens.revoke(refreshToken, userId);
  }

  private async withAccessToken(
    userId: string,
    refreshToken: string,
  ): Promise<TokenPair> {
    return {
      accessToken: await this.jwt.signAsync({ sub: userId }),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}
