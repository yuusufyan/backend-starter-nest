import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { buildPoolConfig } from './database.options.js';

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        drizzle,
        connection: buildPoolConfig({
          DB_HOST: config.get('DB_HOST'),
          DB_PORT: config.get('DB_PORT'),
          DB_USERNAME: config.get('DB_USERNAME'),
          DB_PASSWORD: config.get('DB_PASSWORD'),
          DB_NAME: config.get('DB_NAME'),
          DB_SSL: config.get('DB_SSL'),
        }),
      }),
    }),
  ],
})
export class DatabaseModule {}
