// Marks dist/ as CommonJS.
//
// This package is ESM ("type": "module"), but the worker is compiled to CommonJS so the relative
// imports in src/server need no rewriting. Node decides which it is from the nearest package.json,
// so dist/ needs one of its own saying so — without it, `node dist/server/worker.js` dies on the
// first `require`.
//
// This is a file rather than a `node -e` one-liner in package.json because the quoting needed to
// survive both JSON and the shell is unreadable, and got it wrong.

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
await writeFile(join(dist, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
console.log("dist/package.json written (commonjs)");
