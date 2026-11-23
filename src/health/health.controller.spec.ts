import { ServiceUnavailableException } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { TerminusModule } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller.js';

// Memakai TerminusModule sungguhan; hanya `db` yang diganti tiruan.
async function build(execute: () => Promise<unknown>) {
  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule],
    controllers: [HealthController],
    providers: [{ provide: getDrizzleToken(), useValue: { execute } }],
  }).compile();
  await moduleRef.init();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('status ok saat database menjawab', async () => {
    const controller = await build(async () => ({ rows: [{ '?column?': 1 }] }));
    const res = await controller.check();
    expect(res.status).toBe('ok');
    expect(res.info?.database?.status).toBe('up');
  });

  it('503 saat database down, tanpa membocorkan pesan error mentah', async () => {
    const controller = await build(async () => {
      throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), {
        code: 'ECONNREFUSED',
      });
    });

    const err = await controller.check().then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    const body = JSON.stringify(
      (err as ServiceUnavailableException).getResponse(),
    );
    expect(body).toContain('"status":"error"');
    expect(body).toContain('Database unavailable');
    expect(body).not.toContain('10.0.0.5');
  });
});
