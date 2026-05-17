/**
 * Recipe sandbox child process.
 *
 * Loads exactly one `.recipe.ts` in isolation and sends the exported recipe
 * object back to the parent (`./load.ts`) over the fork IPC channel. The
 * parent spawns this with a clean environment — no scai tokens or secrets —
 * so a hostile recipe has nothing to read or exfiltrate, and a crash or hang
 * here cannot take scai down. Whatever crosses back is re-validated against
 * the Zod schema by the parent. See docs/recipe-sandbox.md.
 *
 * This file is intentionally dependency-free apart from `tsx`: it runs in
 * the untrusted child and must not import scai internals.
 */

interface LoaderResult {
  ok: boolean;
  recipe?: unknown;
  error?: string;
}

const report = (result: LoaderResult, exitCode: number): void => {
  if (process.send) {
    process.send(result, () => process.exit(exitCode));
  } else {
    process.exit(exitCode);
  }
};

const main = (): void => {
  const recipePath = process.argv[2];
  if (!recipePath) {
    report({ ok: false, error: "no recipe path argument" }, 2);
    return;
  }

  /* eslint-disable @typescript-eslint/no-require-imports */
  const tsxApi = require("tsx/cjs/api") as { register: () => unknown };
  tsxApi.register();
  const mod = require(recipePath) as Record<string, unknown> & { default?: unknown };
  /* eslint-enable @typescript-eslint/no-require-imports */

  let recipe: unknown = mod.default;
  if (recipe === undefined) {
    // Fall back to the first non-default exported value.
    for (const key of Object.keys(mod)) {
      if (key !== "default" && mod[key] !== undefined) {
        recipe = mod[key];
        break;
      }
    }
  }
  report({ ok: true, recipe: recipe ?? null }, 0);
};

try {
  main();
} catch (error) {
  report({ ok: false, error: error instanceof Error ? error.message : String(error) }, 1);
}
