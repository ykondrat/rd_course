import { encodeCursor } from './cursor';

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export function buildPage<T extends { created_at: string; id: number }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    next_cursor: hasMore && last ? encodeCursor({ c: last.created_at, id: last.id }) : null,
  };
}
