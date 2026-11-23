import type { JwtModuleOptions } from '@nestjs/jwt';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_ALGORITHM,
  JWT_ISSUER,
} from './auth.constants.js';

/** Satu sumber opsi JWT untuk AuthModule (dan tes), supaya tidak melenceng. */
export function buildJwtOptions(secret: string): JwtModuleOptions {
  return {
    secret,
    signOptions: {
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    },
    // Algoritma dikunci: token ber-alg lain (termasuk `none`) ditolak.
    verifyOptions: { algorithms: [JWT_ALGORITHM], issuer: JWT_ISSUER },
  };
}
