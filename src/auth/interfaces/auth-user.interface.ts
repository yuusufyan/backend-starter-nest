/** Identitas user yang sudah lolos `JwtAuthGuard` (dimuat segar dari DB per request). */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface AuthenticatedRequest {
  headers: { authorization?: string };
  user?: AuthUser;
}
