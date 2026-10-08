import "server-only";
import mysql, { type Pool, type ResultSetHeader } from "mysql2/promise";
import { migrate, SCHEMA } from "./schema.mjs";

declare global {
  // eslint-disable-next-line no-var
  var __evPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __evSchema: Promise<void> | undefined;
}

function createPool() {
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connectionLimit: 10,
    waitForConnections: true,
    // The remote server drops idle sockets; keep them alive and recycle idle ones quickly.
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    maxIdle: 2,
    idleTimeout: 30_000,
    connectTimeout: 15_000,
    timezone: "Z",
    dateStrings: false,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
}

export function pool(): Pool {
  if (!globalThis.__evPool) globalThis.__evPool = createPool();
  return globalThis.__evPool;
}

async function ensureSchema() {
  if (!globalThis.__evSchema) {
    globalThis.__evSchema = (async () => {
      for (const stmt of SCHEMA) await withRetry(() => pool().query(stmt));
      await migrate(async (sql: string, params: unknown[]) => (await withRetry(() => pool().query(sql, params)))[0]);
    })().catch((err) => {
      globalThis.__evSchema = undefined;
      throw err;
    });
  }
  return globalThis.__evSchema;
}

const RETRYABLE = new Set(["ECONNRESET", "PROTOCOL_CONNECTION_LOST", "EPIPE", "ETIMEDOUT", "ECONNREFUSED"]);

/** Runs a query, retrying once if the pool handed out a connection the server had already closed. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!RETRYABLE.has((e as { code?: string }).code ?? "")) throw e;
    return fn();
  }
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  const [rows] = await withRetry(() => pool().query(sql, params));
  return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  await ensureSchema();
  const [res] = await withRetry(() => pool().execute(sql, params as never));
  return res as ResultSetHeader;
}
