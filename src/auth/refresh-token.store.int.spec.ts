import { Redis } from 'ioredis';
import { RefreshTokenStore } from './refresh-token.store.js';

// Tes integrasi dengan Redis sungguhan (≥ 6.2, karena GETDEL). Jalankan dengan
//   TEST_REDIS_URL=redis://localhost:6379 bun run test:int
// Pakai Redis untuk development/test saja (mis. `docker compose up -d redis`).
// Tes hanya menghapus key yang dibuatnya sendiri, tidak pernah FLUSH.
const url = process.env.TEST_REDIS_URL;

describe.skipIf(!url)('RefreshTokenStore (Redis sungguhan)', () => {
  let redis: Redis;
  let store: RefreshTokenStore;
  let existing: Set<string>;

  beforeAll(() => {
    redis = new Redis(url!);
  });

  afterAll(() => redis.quit());

  beforeEach(async () => {
    existing = new Set(await redis.keys('auth:*'));
    store = new RefreshTokenStore(redis);
  });

  afterEach(async () => {
    const created = (await redis.keys('auth:*')).filter(
      (k) => !existing.has(k),
    );
    if (created.length > 0) await redis.del(...created);
  });

  it('rotasi dan pemakaian ulang mencabut seluruh family', async () => {
    const { refreshToken } = await store.issue('u1');
    const next = await store.rotate(refreshToken);
    expect(next.status).toBe('ok');
    if (next.status !== 'ok') return;

    expect(await store.rotate(refreshToken)).toMatchObject({
      status: 'reused',
    });
    expect(await store.rotate(next.refreshToken)).toEqual({
      status: 'invalid',
    });
  });

  it('balapan sungguhan: 20 refresh paralel dengan token yang sama, tepat satu yang menang', async () => {
    const { refreshToken } = await store.issue('u1');
    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.rotate(refreshToken)),
    );
    expect(results.filter((r) => r.status === 'ok')).toHaveLength(1);
  });

  it('TTL terpasang di semua key (tidak ada key tanpa kedaluwarsa)', async () => {
    const { refreshToken } = await store.issue('u1');
    await store.rotate(refreshToken);

    const created = (await redis.keys('auth:*')).filter(
      (k) => !existing.has(k),
    );
    expect(created.length).toBeGreaterThan(0);
    for (const key of created) {
      expect(await redis.ttl(key), key).toBeGreaterThan(0);
    }
  });

  it('revokeAllForUser mematikan semua sesi user', async () => {
    const a = await store.issue('u1');
    const b = await store.issue('u1');
    await store.revokeAllForUser('u1');

    expect(await store.rotate(a.refreshToken)).toEqual({ status: 'invalid' });
    expect(await store.rotate(b.refreshToken)).toEqual({ status: 'invalid' });
  });
});
