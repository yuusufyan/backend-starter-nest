export const JWT_ALGORITHM = 'HS256';
export const JWT_ISSUER = 'backend-starter-nest';

/** Access token berumur pendek; yang panjang adalah refresh token. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Satu refresh token; dipanjangkan tiap rotasi (sliding). */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Batas mutlak satu family (satu login), seberapa sering pun dirotasi. */
export const REFRESH_FAMILY_MAX_SECONDS = 30 * 24 * 60 * 60;

export const INVALID_CREDENTIALS_MESSAGE = 'Email atau password salah';
export const INVALID_REFRESH_TOKEN_MESSAGE = 'Refresh token tidak valid';
