import { z } from 'zod';
import type { PageMeta } from './http';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

export function toSkipTake({ page, limit }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * limit, take: limit };
}

export const uuidParam = z.object({ id: z.string().uuid() });
