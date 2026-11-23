import { Controller, Get } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

// Publik by design: dipanggil load balancer/orchestrator tanpa token.
// Path `/health` persis, selaras dengan skip-list logger & metrics di nest-common.
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    @InjectDrizzle() private readonly db: NodePgDatabase,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      // Terminus tidak punya indikator Drizzle, jadi memakai indikator kustom.
      // Pesan error mentah (host/port) dari driver tidak boleh ikut ke endpoint
      // publik ini; hanya `code` yang tersisa.
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
    ]);
  }
}
