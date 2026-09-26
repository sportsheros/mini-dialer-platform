import type { PageMeta } from '../api/types';

export function Pagination({
  meta,
  onPageChange,
}: {
  meta: PageMeta | undefined;
  onPageChange: (page: number) => void;
}) {
  if (!meta || meta.total === 0) return null;
  const pages = Math.max(1, Math.ceil(meta.total / meta.limit));
  const first = (meta.page - 1) * meta.limit + 1;
  const last = Math.min(meta.page * meta.limit, meta.total);
  return (
    <div className="pagination">
      <span className="muted">
        {first}–{last} of {meta.total}
      </span>
      <div className="pagination-buttons">
        <button
          className="btn btn-small"
          disabled={meta.page <= 1}
          onClick={() => onPageChange(meta.page - 1)}
        >
          ← Prev
        </button>
        <span>
          Page {meta.page} / {pages}
        </span>
        <button
          className="btn btn-small"
          disabled={meta.page >= pages}
          onClick={() => onPageChange(meta.page + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
