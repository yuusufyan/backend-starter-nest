import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { buildJwtOptions } from './jwt.options.js';
import { RefreshTokenStore } from './refresh-token.store.js';

/**
 * Modul yang memakai `@UseGuards(JwtAuthGuard)` harus meng-import AuthModule
 * (menyediakan JwtService dan UsersRepository yang dibutuhkan guard).
 */
@Module({
  imports: [
    UsersModule,
    // Batas dasar; login dan refresh memperketat lewat @Throttle di controller.
    // Hitungan disimpan di memori proses (per instance).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }],
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildJwtOptions(config.getOrThrow<string>('JWT_SECRET')),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenStore, JwtAuthGuard],
  exports: [JwtModule, UsersModule, JwtAuthGuard],
})
export class AuthModule {}
