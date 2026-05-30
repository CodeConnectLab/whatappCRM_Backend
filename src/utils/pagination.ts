import type { FilterQuery } from 'mongoose';

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export function parsePagination(query: Record<string, unknown>): Required<PaginationQuery> {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const sort = typeof query.sort === 'string' && query.sort ? query.sort : 'createdAt';
  const order = query.order === 'asc' ? 'asc' : 'desc';
  return { page, limit, sort, order };
}

export async function paginate<T>(
  model: {
    find: (filter: FilterQuery<T>) => {
      sort: (s: Record<string, 1 | -1>) => {
        skip: (n: number) => { limit: (n: number) => { lean: () => Promise<T[]> } };
      };
    };
    countDocuments: (filter: FilterQuery<T>) => Promise<number>;
  },
  filter: FilterQuery<T>,
  opts: Required<PaginationQuery>,
): Promise<PaginatedResult<T>> {
  const skip = (opts.page - 1) * opts.limit;
  const sortField: Record<string, 1 | -1> = { [opts.sort]: opts.order === 'asc' ? 1 : -1 };
  const [data, total] = await Promise.all([
    model.find(filter).sort(sortField).skip(skip).limit(opts.limit).lean(),
    model.countDocuments(filter),
  ]);
  return { data, total, page: opts.page, limit: opts.limit };
}
