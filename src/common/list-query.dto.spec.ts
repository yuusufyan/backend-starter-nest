import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from './validation.pipe.js';
import { ListQueryDto } from './list-query.dto.js';

const meta = { type: 'query' as const, metatype: ListQueryDto };

describe('ListQueryDto', () => {
  const pipe = createValidationPipe();

  it('mengubah query string angka dan menerima nilai valid', async () => {
    const out = await pipe.transform(
      { page: '2', limit: '50', orderBy: 'DESC', sortBy: 'createdAt' },
      meta,
    );
    expect(out).toMatchObject({ page: 2, limit: 50, orderBy: 'DESC' });
  });

  it.each([
    ['limit di atas batas', { limit: '101' }],
    ['limit nol', { limit: '0' }],
    ['orderBy tidak dikenal', { orderBy: 'RANDOM' }],
    ['properti di luar DTO', { isAdmin: 'true' }],
  ])('menolak %s', async (_name, query) => {
    await expect(pipe.transform(query, meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
