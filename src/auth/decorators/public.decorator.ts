import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Menandai route yang sengaja terbuka tanpa token. Guard dipasang per route
 * (`@UseGuards(JwtAuthGuard)`), jadi penanda ini tidak mengubah perilaku saat
 * runtime; fungsinya mendokumentasikan niat dan dibaca tes `route-guards`,
 * yang gagal bila ada route tanpa guard dan tanpa penanda ini.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
