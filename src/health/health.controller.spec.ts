import { ServiceUnavailableException } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { TerminusModule } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import { HealthController } from './health.controller.js';

const up = async () => 'ok';
const down = (message: string) => async () => {
  throw Object.assign(new Error(message), { code: 'ECONNREFUSED' });
};

// Memakai TerminusModule sungguhan; hanya `db` dan `redis` yang diganti tiruan.
async function build(deps: {
  execute?: () => Promise<unknown>;
  ping?: () => Promise<unknown>;
}) {
  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule],
    controllers: [HealthController],
    providers: [
      { provide: getDrizzleToken(), useValue: { execute: deps.execute ?? up } },
      { provide: REDIS_CLIENT, useValue: { ping: deps.ping ?? up } },
    ],
  }).compile();
  await moduleRef.init();
  return moduleRef.get(HealthController);
}

async function failure(controller: HealthController): Promise<string> {
  const err = await controller.check().then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ServiceUnavailableException);
  return JSON.stringify((err as ServiceUnavailableException).getResponse());
}

describe('HealthController', () => {
  it('status ok saat database dan redis menjawab', async () => {
    const res = await (await build({})).check();
    expect(res.status).toBe('ok');
    expect(res.info?.database?.status).toBe('up');
    expect(res.info?.redis?.status).toBe('up');
  });

  it('503 saat database down, tanpa membocorkan pesan error mentah', async () => {
    const body = await failure(
      await build({ execute: down('connect ECONNREFUSED 10.0.0.5:5432') }),
    );
    expect(body).toContain('"status":"error"');
    expect(body).toContain('Database unavailable');
    expect(body).not.toContain('10.0.0.5');
  });

  it('503 saat redis down, tanpa membocorkan pesan error mentah', async () => {
    const body = await failure(
      await build({ ping: down('connect ECONNREFUSED 10.0.0.9:6379') }),
    );
    expect(body).toContain('Redis unavailable');
    expect(body).not.toContain('10.0.0.9');
  });
});
