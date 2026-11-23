import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type {
  AuthenticatedRequest,
  AuthUser,
} from '../interfaces/auth-user.interface.js';

/**
 * Mengambil user dari request: `@CurrentUser()` atau `@CurrentUser('id')`.
 * Hanya terisi pada route yang memakai `JwtAuthGuard`.
 */
export const CurrentUser = createParamDecorator(
  (key: keyof AuthUser | undefined, context: ExecutionContext) => {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    return key ? user?.[key] : user;
  },
);
