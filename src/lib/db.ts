import pg from 'pg';
import type { Pool, PoolClient } from 'pg';
import { env } from './config.ts';

export function connect() {
  return new pg.Pool({
    connectionString: env('DATABASE_URL'),
    connectionTimeoutMillis: 2500,
    statement_timeout: 5000,
  });
}

export async function transaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
