import { ServiceUnavailableException } from '@nestjs/common';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { RefreshTokenStore } from './refresh-token.store.js';

describe('RefreshTokenStore', () => {
  let redis: Redis;
  let store: RefreshTokenStore;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    store = new RefreshTokenStore(redis);
  });

  afterEach(() => redis.quit());

  it('Redis mati/timeout menjadi 503 tanpa membocorkan detail koneksi', async () => {
    const rusak = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error('connect ECONNREFUSED 10.0.0.9:6379');
        },
      },
    ) as unknown as Redis;
    const broken = new RefreshTokenStore(rusak);

    for (const operation of [
      () => broken.issue('u1'),
      () => broken.rotate('apa-saja'),
      () => broken.revoke('apa-saja', 'u1'),
      () => broken.revokeAllForUser('u1'),
    ]) {
      const error = await operation().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as Error).message).not.toContain('10.0.0.9');
    }
  });

  it('issue: token acak, dan hanya hash-nya yang disimpan di Redis', async () => {
    const { refreshToken } = await store.issue('u1');
    expect(refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const keys = await redis.keys('*');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join('|')).not.toContain(refreshToken);
    for (const key of keys) {
      if ((await redis.type(key)) === 'string') {
        expect(await redis.get(key)).not.toContain(refreshToken);
      }
    }
  });

  it('rotate: token lama diganti yang baru, dan yang baru bisa dirotasi lagi', async () => {
    const { refreshToken, familyId } = await store.issue('u1');

    const first = await store.rotate(refreshToken);
    expect(first).toMatchObject({ status: 'ok', userId: 'u1', familyId });
    if (first.status !== 'ok') throw new Error('seharusnya ok');
    expect(first.refreshToken).not.toBe(refreshToken);

    const second = await store.rotate(first.refreshToken);
    expect(second).toMatchObject({ status: 'ok', familyId });
  });

  it('token yang tidak dikenal ditolak', async () => {
    expect(await store.rotate('token-ngawur')).toEqual({ status: 'invalid' });
  });

  it('reuse: token lama yang dipakai lagi mencabut seluruh family, termasuk token barunya', async () => {
    const { refreshToken } = await store.issue('u1');
    const rotated = await store.rotate(refreshToken);
    if (rotated.status !== 'ok') throw new Error('seharusnya ok');

    const replay = await store.rotate(refreshToken);
    expect(replay).toMatchObject({ status: 'reused', userId: 'u1' });

    // Token baru milik pemilik sah ikut mati: yang mana pemiliknya tidak bisa dibedakan.
    expect(await store.rotate(rotated.refreshToken)).toEqual({
      status: 'invalid',
    });
  });

  it('balapan: dua refresh paralel dengan token sama, hanya satu yang menang', async () => {
    const { refreshToken } = await store.issue('u1');
    const results = await Promise.all([
      store.rotate(refreshToken),
      store.rotate(refreshToken),
      store.rotate(refreshToken),
    ]);
    expect(results.filter((r) => r.status === 'ok')).toHaveLength(1);
  });

  it('revoke: ditolak untuk bukan pemilik dan sesi tidak terpengaruh', async () => {
    const { refreshToken } = await store.issue('u1');
    expect(await store.revoke(refreshToken, 'orang-lain')).toBe(false);
    expect(await store.rotate(refreshToken)).toMatchObject({ status: 'ok' });
  });

  it('revoke: token yang sudah dirotasi tetap bisa dipakai untuk logout satu sesi', async () => {
    const { refreshToken } = await store.issue('u1');
    const rotated = await store.rotate(refreshToken);
    if (rotated.status !== 'ok') throw new Error('seharusnya ok');

    // Klien logout dengan token lama (sudah dirotasi): sesinya tetap harus mati.
    expect(await store.revoke(refreshToken, 'u1')).toBe(true);
    expect(await store.rotate(rotated.refreshToken)).toEqual({
      status: 'invalid',
    });
    expect(await store.revoke('tidak-ada', 'u1')).toBe(false);
  });

  it('revokeAllForUser: semua sesi user mati, sesi user lain tidak terpengaruh', async () => {
    const a1 = await store.issue('u1');
    const a2 = await store.issue('u1');
    const b = await store.issue('u2');

    await store.revokeAllForUser('u1');

    expect(await store.rotate(a1.refreshToken)).toEqual({ status: 'invalid' });
    expect(await store.rotate(a2.refreshToken)).toEqual({ status: 'invalid' });
    expect(await store.rotate(b.refreshToken)).toMatchObject({ status: 'ok' });
  });

  it('family kedaluwarsa mutlak: tidak bisa diperpanjang selamanya', async () => {
    const { refreshToken } = await store.issue('u1');
    const key = (await redis.keys('auth:rt:*'))[0];
    const record = JSON.parse((await redis.get(key))!);
    record.familyExpiresAt = Date.now() - 1000;
    await redis.set(key, JSON.stringify(record), 'EX', 60);

    expect(await store.rotate(refreshToken)).toEqual({ status: 'invalid' });
  });

  it('TTL token tidak melewati sisa umur family', async () => {
    const { refreshToken } = await store.issue('u1');
    const key = (await redis.keys('auth:rt:*'))[0];
    const record = JSON.parse((await redis.get(key))!);
    record.familyExpiresAt = Date.now() + 60_000; // sisa 60 detik
    await redis.set(key, JSON.stringify(record), 'EX', 600);

    const rotated = await store.rotate(refreshToken);
    expect(rotated.status).toBe('ok');
    const keys = await redis.keys('auth:rt:*');
    expect(keys).toHaveLength(1);
    expect(await redis.ttl(keys[0])).toBeLessThanOrEqual(60);
  });
});
