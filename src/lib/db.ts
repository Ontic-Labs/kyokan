import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

// Singleton pool for hot reload safety in development
const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
};

function getPool(): Pool {
  if (!globalForDb.pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    globalForDb.pool = new Pool({
      connectionString,
      max: process.env.NODE_ENV === "production" ? 5 : 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ...(process.env.NODE_ENV === "production" && {
        ssl: { rejectUnauthorized: false },
      }),
    });
  }
  return globalForDb.pool;
}

/**
 * Execute a query against the database
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const pool = getPool();
  return pool.query<T>(sql, params);
}

/**
 * Execute a function within a transaction
 */
export async function tx<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get a client for batch operations (caller must release)
 */
export async function getClient(): Promise<PoolClient> {
  const pool = getPool();
  return pool.connect();
}

export const db = {
  query,
  tx,
  getClient,
};
