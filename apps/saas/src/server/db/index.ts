import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * One connection pool per process.
 *
 * Next's dev server reloads modules on every change, which would otherwise open a new pool each
 * time until Postgres refuses more connections. Stashing it on `globalThis` is the usual way out.
 */
const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

const url = process.env.DATABASE_URL ?? "postgres://bevoiced:bevoiced@localhost:5432/bevoiced";

export const sql = globalForDb.__sql ?? postgres(url, { max: 10, onnotice: () => {} });
if (process.env.NODE_ENV !== "production") globalForDb.__sql = sql;

export const db = drizzle(sql, { schema });
export { schema };
