import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  escapeLike,
  normalizePagination,
} from './list-query.js';

describe('normalizePagination', () => {
  it('memakai default saat kosong', () => {
    expect(normalizePagination({})).toEqual({
      page: 1,
      limit: DEFAULT_LIMIT,
      offset: 0,
    });
  });

  it('membatasi limit sampai MAX_LIMIT', () => {
    expect(normalizePagination({ limit: 100000 }).limit).toBe(MAX_LIMIT);
  });

  it('nilai tidak valid jatuh ke default', () => {
    const out = normalizePagination({
      page: -3,
      limit: 'abc' as unknown as number,
    });
    expect(out).toEqual({ page: 1, limit: DEFAULT_LIMIT, offset: 0 });
  });

  it('menghitung offset dari page dan limit', () => {
    expect(normalizePagination({ page: 3, limit: 20 }).offset).toBe(40);
  });
});

describe('escapeLike', () => {
  it('meng-escape %, _ dan backslash', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('membiarkan teks biasa', () => {
    expect(escapeLike('budi')).toBe('budi');
  });
});
