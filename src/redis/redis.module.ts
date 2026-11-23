import {
  Global,
  Inject,
  Logger,
  Module,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';
import { buildRedisOptions } from './redis.options.js';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const client = new Redis(
          buildRedisOptions({
            REDIS_HOST: config.get('REDIS_HOST'),
            REDIS_PORT: config.get('REDIS_PORT'),
            REDIS_PASSWORD: config.get('REDIS_PASSWORD'),
            REDIS_DB: config.get('REDIS_DB'),
          }),
        );
        // Tanpa listener, event 'error' ioredis menjatuhkan proses.
        const logger = new Logger('Redis');
        client.on('error', (error: Error) => logger.error(error.message));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
