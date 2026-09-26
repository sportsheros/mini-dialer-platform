import type { ReactNode } from 'react';
import { Empty, ErrorState, Loading } from './QueryStates';

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  width?: string;
  align?: 'left' | 'right';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: Error;
  onRetry?: () => void;
  emptyMessage?: ReactNode;
  onRowClick?: (row: T) => void;
}

/** Table with built-in loading / error / empty states, so every data view handles all three. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  emptyMessage = 'Nothing here yet.',
  onRowClick,
}: DataTableProps<T>) {
  if (error && !rows) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading && !rows) return <Loading />;
  if (!rows || rows.length === 0) return <Empty>{emptyMessage}</Empty>;

  return (
    <div className="table-wrap">
      {error && <ErrorState error={error} onRetry={onRetry} />}
      <table className={`table ${loading ? 'table-loading' : ''}`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} style={{ width: c.width, textAlign: c.align }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'clickable' : undefined}
            >
              {columns.map((c) => (
                <td key={c.header} style={{ textAlign: c.align }}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
