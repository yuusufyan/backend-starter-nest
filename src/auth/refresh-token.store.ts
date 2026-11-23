import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import {
  REFRESH_FAMILY_MAX_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from './auth.constants.js';

interface TokenRecord {
  userId: string;
  familyId: string;
  /** Epoch ms; family tidak bisa diperpanjang melewati ini. */
  familyExpiresAt: number;
}

export type RotateResult =
  | { status: 'ok'; userId: string; familyId: string; refreshToken: string }
  /** Tidak dikenal, kedaluwarsa, atau family-nya sudah dicabut. */
  | { status: 'invalid' }
  /** Token yang sudah dipakai muncul lagi (kemungkinan dicuri): family dicabut. */
  | { status: 'reused'; userId: string; familyId: string };

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

// Hanya hash token yang disimpan di Redis, tidak pernah token mentahnya.
const tokenKey = (h: string) => `auth:rt:${h}`; // token aktif -> TokenRecord
const usedKey = (h: string) => `auth:rtu:${h}`; // token yang sudah dipakai -> {userId, familyId}
const currentKey = (familyId: string) => `auth:rtf:${familyId}`; // hash token aktif milik family
const revokedKey = (familyId: string) => `auth:rtrev:${familyId}`; // penanda family dicabut
const userFamiliesKey = (userId: string) => `auth:rtuser:${userId}`; // set family milik user

/**
 * Refresh token opaque (acak 256-bit) di Redis, dengan rotasi: setiap
 * dipakai, token diganti yang baru dan yang lama ditandai terpakai. Bila token
 * terpakai muncul lagi, seluruh family (satu login) dicabut.
 *
 * Konsumsi token memakai `GETDEL` (atomik), jadi dari beberapa refresh
 * paralel dengan token yang sama hanya satu yang menang.
 */
@Injectable()
export class RefreshTokenStore {
  private readonly logger = new Logger(RefreshTokenStore.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  issue(userId: string): Promise<{ refreshToken: string; familyId: string }> {
    return this.run(() => this.doIssue(userId));
  }

  rotate(refreshToken: string): Promise<RotateResult> {
    return this.run(() => this.doRotate(refreshToken));
  }

  /**
   * Logout: mencabut seluruh family dari token ini (aktif maupun yang sudah
   * dirotasi), hanya bila token itu milik `userId`. `true` bila ada yang dicabut.
   */
  revoke(refreshToken: string, userId: string): Promise<boolean> {
    return this.run(() => this.doRevoke(refreshToken, userId));
  }

  /** Mencabut semua sesi (family) milik user, mis. saat password diganti. */
  revokeAllForUser(userId: string): Promise<void> {
    return this.run(() => this.doRevokeAllForUser(userId));
  }

  // Redis yang mati/timeout adalah gangguan layanan (503), bukan bug (500).
  // Detail error hanya ke log; klien tidak melihat host/port.
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logger.error(
        `Penyimpanan refresh token gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(
        'Layanan autentikasi sementara tidak tersedia',
      );
    }
  }

  private async doIssue(
    userId: string,
  ): Promise<{ refreshToken: string; familyId: string }> {
    const record: TokenRecord = {
      userId,
      familyId: randomUUID(),
      familyExpiresAt: Date.now() + REFRESH_FAMILY_MAX_SECONDS * 1000,
    };
    const refreshToken = await this.save(record, REFRESH_TOKEN_TTL_SECONDS);
    return { refreshToken, familyId: record.familyId };
  }

  private async doRotate(refreshToken: string): Promise<RotateResult> {
    const h = hash(refreshToken);
    const raw = await this.redis.getdel(tokenKey(h));

    if (!raw) {
      const used = await this.redis.get(usedKey(h));
      if (!used) return { status: 'invalid' };
      const { userId, familyId } = JSON.parse(used) as {
        userId: string;
        familyId: string;
      };
      await this.revokeFamily(familyId);
      return { status: 'reused', userId, familyId };
    }

    const record = JSON.parse(raw) as TokenRecord;
    const remaining = Math.floor((record.familyExpiresAt - Date.now()) / 1000);
    if (
      remaining <= 0 ||
      (await this.redis.exists(revokedKey(record.familyId)))
    ) {
      return { status: 'invalid' };
    }

    const ttl = Math.min(REFRESH_TOKEN_TTL_SECONDS, remaining);
    const next = await this.save(record, ttl, {
      usedHash: h,
      usedTtl: remaining,
    });

    // Pencabutan family bisa menyelip di antara pemeriksaan dan penyimpanan di
    // atas; tutup celah itu sebelum token baru diberikan ke pemanggil.
    if (await this.redis.exists(revokedKey(record.familyId))) {
      await this.redis.del(tokenKey(hash(next)), currentKey(record.familyId));
      return { status: 'invalid' };
    }
    return {
      status: 'ok',
      userId: record.userId,
      familyId: record.familyId,
      refreshToken: next,
    };
  }

  private async doRevoke(
    refreshToken: string,
    userId: string,
  ): Promise<boolean> {
    const h = hash(refreshToken);
    const raw =
      (await this.redis.get(tokenKey(h))) ?? (await this.redis.get(usedKey(h)));
    if (!raw) return false;
    const owner = JSON.parse(raw) as { userId: string; familyId: string };
    if (owner.userId !== userId) return false;
    await this.revokeFamily(owner.familyId);
    return true;
  }

  private async doRevokeAllForUser(userId: string): Promise<void> {
    const families = await this.redis.smembers(userFamiliesKey(userId));
    await Promise.all(families.map((familyId) => this.revokeFamily(familyId)));
    await this.redis.del(userFamiliesKey(userId));
  }

  private async save(
    record: TokenRecord,
    ttl: number,
    used?: { usedHash: string; usedTtl: number },
  ): Promise<string> {
    const refreshToken = randomBytes(32).toString('base64url');
    const h = hash(refreshToken);
    const multi = this.redis.multi();
    multi.set(tokenKey(h), JSON.stringify(record), 'EX', ttl);
    multi.set(currentKey(record.familyId), h, 'EX', ttl);
    multi.sadd(userFamiliesKey(record.userId), record.familyId);
    multi.expire(userFamiliesKey(record.userId), REFRESH_FAMILY_MAX_SECONDS);
    if (used) {
      multi.set(
        usedKey(used.usedHash),
        JSON.stringify({ userId: record.userId, familyId: record.familyId }),
        'EX',
        used.usedTtl,
      );
    }
    await multi.exec();
    return refreshToken;
  }

  private async revokeFamily(familyId: string): Promise<void> {
    const current = await this.redis.get(currentKey(familyId));
    const multi = this.redis.multi();
    multi.set(revokedKey(familyId), '1', 'EX', REFRESH_FAMILY_MAX_SECONDS);
    multi.del(currentKey(familyId));
    if (current) multi.del(tokenKey(current));
    await multi.exec();
  }
}
