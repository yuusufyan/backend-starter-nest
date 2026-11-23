import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersRepository } from '../../users/users.repository.js';
import type { AuthenticatedRequest } from '../interfaces/auth-user.interface.js';

interface AccessTokenPayload {
  sub?: unknown;
}

const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

/**
 * Menolak request tanpa access token yang valid (401, pesan generik). Tanda
 * tangan, algoritma, issuer, dan kedaluwarsa diperiksa oleh `JwtService`
 * (lihat `AuthModule`). User dimuat ulang dari DB di setiap request, jadi user
 * yang dinonaktifkan/dihapus langsung kehilangan akses, tanpa menunggu token habis.
 *
 * Dipasang per route: `@UseGuards(JwtAuthGuard)`. Modul pemakai harus meng-import
 * `AuthModule`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (typeof payload.sub !== 'string') throw new UnauthorizedException();

    const profile = await this.users.findAuthProfile(payload.sub);
    if (!profile?.isActive) throw new UnauthorizedException();

    request.user = {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      role: profile.role,
    };
    return true;
  }
}
