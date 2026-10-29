// Applies the SQL files in src/server/db/migrations, in order, once each.
//
// Deliberately small: a table of what has run, a transaction per file. Anything cleverer than this
// is a dependency to maintain for a problem nobody has yet.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "src", "server", "db", "migrations");
const url = process.env.DATABASE_URL ?? "postgres://soundbite:soundbite@localhost:5432/soundbite";

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  await sql`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  const done = new Set((await sql`SELECT name FROM _migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const body = await readFile(join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO _migrations (name) VALUES (${file})`;
    });
    console.log(`applied ${file}`);
    applied++;
  }
  console.log(applied ? `${applied} migration(s) applied` : "already up to date");
} finally {
  await sql.end();
}
