#!/usr/bin/env node

/**
 * Add explicit `.js` extensions to relative specifiers in the emitted `.d.ts`.
 *
 * The package is `"type": "module"`. Under `moduleResolution: NodeNext` — which
 * demo-orchestrator uses — a declaration file inside a type:module package is
 * read as an ES module, and ESM requires explicit extensions. An extensionless
 * `export * from "./schema"` therefore does not resolve, and every type it
 * re-exports silently degrades to an implicit `any` in the consumer.
 *
 * "Silently" is the important word. It does not error at the import site; it
 * surfaces somewhere unrelated, as a lone `TS7006: Parameter 'd' implicitly has
 * an 'any' type` in a `.some()` callback several hops away. That is exactly how
 * it was caught here: the orchestrator typechecks clean against the published
 * CommonJS 0.40.3 and reported one such error against this build.
 *
 * `tsc-alias --resolve-full-paths` does not cover this. It rewrites the `@/*`
 * ALIAS specifiers (of which there are ~1186) but leaves plain relative ones
 * untouched, so it has to run first and this has to run after.
 *
 * Emitting the extensions from `tsc` directly would mean `moduleResolution:
 * NodeNext` in this repo's own tsconfig, which would in turn require writing
 * `./foo.js` in ~1186 source imports and abandoning the `@/*` aliases. esbuild
 * resolves both happily, so the source stays as-is and the declarations get
 * fixed up here.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

/** `from "./x"` / `from "../x"` — captures the quote so it can be restored. */
const SPECIFIER = /(\bfrom\s*)(["'])(\.\.?\/[^"']*)\2/g;

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // dist/esm is esbuild's output — already correct, and not declarations.
    if (entry.isDirectory()) {
      if (entry.name === "esm") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
};

/**
 * `./schema` may mean `./schema.d.ts` or `./schema/index.d.ts`. Resolve against
 * the filesystem rather than guessing, so a directory import gets `/index.js`.
 */
const withExtension = (fileDir, specifier) => {
  if (/\.(js|json|mjs|cjs)$/.test(specifier)) return specifier;
  const target = resolve(fileDir, specifier);
  try {
    if (statSync(target).isDirectory()) return `${specifier}/index.js`;
  } catch {
    /* not a directory — fall through to the file form */
  }
  return `${specifier}.js`;
};

const files = walk(DIST);
let rewritten = 0;
let touched = 0;

for (const file of files) {
  const before = readFileSync(file, "utf8");
  let count = 0;
  const after = before.replace(SPECIFIER, (match, kw, quote, spec) => {
    const next = withExtension(dirname(file), spec);
    if (next === spec) return match;
    count += 1;
    return `${kw}${quote}${next}${quote}`;
  });
  if (count > 0) {
    writeFileSync(file, after);
    rewritten += count;
    touched += 1;
  }
}

if (files.length === 0) {
  process.stderr.write("fix-declaration-extensions: no .d.ts found — run tsc first\n");
  process.exit(1);
}

process.stdout.write(
  `fix-declaration-extensions: ${rewritten} specifier(s) in ${touched} of ${files.length} declaration file(s)\n`
);
