export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;

export type SortDirection = 'ASC' | 'DESC';

export interface ListQuery {
  page?: number;
  limit?: number;
  term?: string;
  sortBy?: string;
  orderBy?: SortDirection;
}

export interface Page<TRow> {
  data: TRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const toPositiveInt = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
};

/** Paginasi aman: limit selalu dibatasi `MAX_LIMIT`, nilai aneh jatuh ke default. */
export function normalizePagination(query: ListQuery) {
  const page = toPositiveInt(query.page, DEFAULT_PAGE);
  const limit = Math.min(toPositiveInt(query.limit, DEFAULT_LIMIT), MAX_LIMIT);
  return { page, limit, offset: (page - 1) * limit };
}

/** Escape karakter khusus LIKE agar `%` dan `_` dari user dicari apa adanya. */
export const escapeLike = (term: string): string =>
  term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
