import { Controller, Get, Inject } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import { Public } from '../auth/decorators/public.decorator.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';

// Publik by design: dipanggil load balancer/orchestrator tanpa token.
// Path `/health` persis, selaras dengan skip-list logger & metrics di nest-common.
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    @InjectDrizzle() private readonly db: NodePgDatabase,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      // Terminus tidak punya indikator Drizzle/Redis, jadi memakai indikator
      // kustom. Pesan error mentah (host/port) dari driver tidak boleh ikut ke
      // endpoint publik ini; hanya `code` yang tersisa.
      () =>
        this.indicator
          .check('database')
          .attempt(async () => {
            await this.db.execute(sql`select 1`);
          })
          .withFailureData((error: { code?: string }) => ({
            message: 'Database unavailable',
            code: error.code,
          }))
          .withTimeout('1s'),
      // Login dan refresh token bergantung pada Redis, jadi ikut readiness.
      () =>
        this.indicator
          .check('redis')
          .attempt(async () => {
            await this.redis.ping();
          })
          .withFailureData((error: { code?: string }) => ({
            message: 'Redis unavailable',
            code: error.code,
          }))
          .withTimeout('1s'),
    ]);
  }
}
