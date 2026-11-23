import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { IsEmail, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { createValidationPipe } from './validation.pipe.js';

class SampleDto {
  @IsEmail()
  email: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number;
}

const meta: ArgumentMetadata = { type: 'body', metatype: SampleDto };

describe('createValidationPipe', () => {
  const pipe = createValidationPipe();

  it('menerima input valid dan mengubah tipenya', async () => {
    const out = await pipe.transform({ email: 'a@b.id', page: '2' }, meta);
    expect(out).toBeInstanceOf(SampleDto);
    expect(out.page).toBe(2);
  });

  it('menolak input tidak valid', async () => {
    await expect(
      pipe.transform({ email: 'bukan-email', page: 0 }, meta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('menolak properti di luar DTO', async () => {
    await expect(
      pipe.transform({ email: 'a@b.id', page: 1, isAdmin: true }, meta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
