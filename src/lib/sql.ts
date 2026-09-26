import type { DataSource, EntityManager } from 'typeorm';

type Queryable = Pick<EntityManager, 'query'> | Pick<DataSource, 'query'>;

/**
 * Runs raw SQL and always returns the result rows.
 *
 * Why this exists: TypeORM's Postgres driver returns `rows` for SELECT/INSERT but
 * `[rows, rowCount]` for UPDATE/DELETE. Code like `(await query('UPDATE ... RETURNING id')).length`
 * would then always be 2, which silently breaks conditional-update guards. Use this everywhere.
 */
export async function queryRows<T = Record<string, unknown>>(
  db: Queryable,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result: unknown = await db.query(sql, params);
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return result as T[];
}
