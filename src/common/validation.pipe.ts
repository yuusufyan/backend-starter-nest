import { ValidationPipe } from '@nestjs/common';

// Opsi ketat: properti di luar DTO ditolak (bukan sekadar dibuang) supaya
// payload yang salah ketahuan, dan input diubah ke tipe DTO (query/param).
export const createValidationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
