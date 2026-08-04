import { createRequire } from "node:module";
/**
 * Shared `.recipe.ts` loader.
 *
 * Authored recipes (CMS, brand-kit, agents, campaigns, briefs, etc.) all
 * load through this path so end users can write `.recipe.ts` files with
 * Zod-derived types and `satisfies` checks. The transpile + sandboxed
 * execute machinery is owned by `@/recipe/sandbox` — this module is the
 * thin wrapper that picks between the confined child and the legacy
 * in-process tsx loader, and is consumed by both:
 *
 *   - `src/sync/io.ts:loadRecipe` (schema-aware loader used by brand,
 *     agents, campaigns, briefs, …)
 *   - `src/recipe/io.ts:loadRecipe` (CMS recipe discriminated-union loader)
 *
 * Output is unvalidated — callers Zod-parse the returned value. See
 * docs/recipe-sandbox.md.
 */

import path from "node:path";
import { ScaiError, createScaiError } from "@/shared/errors";
import { isRecipeSandboxEnabled, loadRecipeInSandbox } from "@/recipe/sandbox/load";

/**
 * A real CommonJS `require`, constructed explicitly.
 *
 * scai's own output is ESM, but this seam is deliberately CJS: it hands a
 * user's `.recipe.ts` to tsx's **CJS** hook (`tsx/cjs/api`), which is what
 * gives us a synchronous load plus a `require.cache` we can evict per file so
 * re-reading the same recipe in one process picks up edits. The ESM hook has
 * neither — its cache is not addressable, so a second read would return stale
 * exports.
 *
 * So this is not CJS left over from the CommonJS build; it is the correct tool
 * for loading arbitrary user modules, and it stays after the ESM migration.
 */
const nodeRequire = createRequire(import.meta.url);

/** Extensions this loader recognizes as TypeScript-source recipes. */
const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

/** Whether the given file path should be loaded via the TypeScript path. */
export const isTypeScriptRecipePath = (filePath: string): boolean =>
  TS_EXTENSIONS.has(path.extname(filePath).toLowerCase());

/**
 * Load a `.recipe.ts` (or `.tsx`/`.mts`/`.cts`) file and return its
 * exported recipe value. By default the file is loaded in a confined
 * child process (see docs/recipe-sandbox.md) so a hostile recipe cannot
 * run with scai's full privileges. `SITECOREAI_RECIPE_SANDBOX=0` forces
 * the legacy in-process loader (useful for debugging — the warning lands
 * on stderr so JSON-mode CLI streams are not corrupted).
 *
 * The result is unvalidated: callers Zod-parse it.
 */
export const loadTypeScriptRecipe = async (filePath: string): Promise<unknown> => {
  if (isRecipeSandboxEnabled()) {
    return loadRecipeInSandbox(filePath);
  }
  warnSandboxDisabled();
  return loadRecipeInProcess(filePath);
};

/**
 * Lazily install tsx's CommonJS require hook *once* per process. Earlier
 * versions of this loader called `register()` and the matching
 * `unregister` cleanup on every load — fine for one-shot CLI runs but
 * wasteful in long-running surfaces (e.g. `scai cli shell`) where N
 * recipe loads = N register/unregister cycles. Once installed, the hook
 * stays for the rest of the process lifetime; recipe changes mid-session
 * therefore require an exit. The per-recipe `require.cache` clear below
 * handles re-imports of the *same* file path within the same process.
 */
let tsxRegistered = false;
const ensureTsxRegistered = (): void => {
  if (tsxRegistered) {
    return;
  }
  const tsxApi = nodeRequire("tsx/cjs/api") as { register: () => () => void };
  tsxApi.register();
  tsxRegistered = true;
};

let sandboxOptOutWarned = false;
const warnSandboxDisabled = (): void => {
  if (sandboxOptOutWarned) {
    return;
  }
  sandboxOptOutWarned = true;
  // Stderr (not stdout) — MCP and `--json` callers parse stdout as a
  // structured stream and must not see this warning interleaved.
  process.stderr.write(
    "scai: SITECOREAI_RECIPE_SANDBOX=0 — loading .recipe.ts in-process; " +
      "a hostile recipe runs with scai's full privileges.\n"
  );
};

const loadRecipeInProcess = async (filePath: string): Promise<unknown> => {
  const absolute = path.resolve(filePath);
  try {
    ensureTsxRegistered();
    if (nodeRequire.cache[absolute]) {
      delete nodeRequire.cache[absolute];
    }
    const mod = nodeRequire(absolute) as Record<string, unknown> & { default?: unknown };
    if (mod.default !== undefined) {
      return mod.default;
    }
    // Fall back to the first non-default exported value.
    for (const key of Object.keys(mod)) {
      if (key !== "default" && mod[key] !== undefined) {
        return mod[key];
      }
    }
    throw createScaiError(`Recipe at ${filePath} has no exports.`, "INPUT_INVALID", {
      hint: "Add `export default <recipe>` (or any named export) to the file.",
    });
  } catch (error) {
    // Don't double-wrap our own ScaiErrors (e.g. "Recipe at <path> has no exports.").
    if (error instanceof ScaiError) {
      throw error;
    }
    throw createScaiError(
      `Failed to load recipe TypeScript file ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "INPUT_INVALID",
      { hint: "Confirm the file compiles standalone (try `pnpm exec tsx <file>`)." }
    );
  }
};
