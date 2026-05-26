/**
 * Recipe file I/O for the `sync` engine — load a recipe from a YAML,
 * JSON, or TypeScript file and validate it against a kind's schema, or
 * serialize a captured recipe back to disk.
 *
 * Three on-disk formats are supported, all kinds, one loader:
 *
 *   - `.ts` / `.tsx` / `.mts` / `.cts` — TypeScript source. Loaded via
 *     the sandboxed transpile path (`@/sync/typescript-recipe`) so a
 *     hostile authored recipe cannot run with scai's privileges.
 *     Authors get Zod-derived `satisfies` checks at write time.
 *   - `.yaml` / `.yml` — YAML.
 *   - `.json` — JSON (parsed through the YAML parser; YAML is a superset).
 *
 * See docs/recipe-sync-architecture.md and docs/recipe-sandbox.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ZodType } from "zod";
import { createScaiError } from "@/shared/errors";
import { isTypeScriptRecipePath, loadTypeScriptRecipe } from "./typescript-recipe";

/**
 * Read, parse, and schema-validate a recipe file. The on-disk format is
 * picked from the file extension:
 *
 *   - `.ts` / `.tsx` / `.mts` / `.cts` → transpiled + executed in the
 *     recipe sandbox; the default export (or first named export) is
 *     Zod-parsed.
 *   - everything else → read as text and run through the YAML parser
 *     (which also accepts JSON).
 *
 * Async because the TypeScript path forks a child process. All current
 * call sites already run inside `async` task runners or commander
 * `command.action(async …)` handlers.
 */
export const loadRecipe = async <T>(filePath: string, schema: ZodType<T>): Promise<T> => {
  const parsed = isTypeScriptRecipePath(filePath)
    ? await loadTypeScriptRecipe(filePath)
    : parseYamlOrJsonRecipe(filePath);

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw createScaiError(`Recipe file "${filePath}" failed schema validation`, "INPUT_INVALID", {
      details: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`
      ),
    });
  }
  return result.data;
};

/** Read and YAML-parse a recipe file. YAML is a superset of JSON, so
 * `.yaml`, `.yml`, and `.json` all go through the same path. */
const parseYamlOrJsonRecipe = (filePath: string): unknown => {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw createScaiError(`Cannot read recipe file "${filePath}"`, "INPUT_INVALID", {
      hint: error instanceof Error ? error.message : undefined,
    });
  }

  try {
    return parseYaml(raw);
  } catch (error) {
    throw createScaiError(`Recipe file "${filePath}" is not valid YAML/JSON`, "INPUT_INVALID", {
      hint: error instanceof Error ? error.message : undefined,
    });
  }
};

/** Serialize a recipe to a file — JSON when the path ends `.json`, else YAML. */
export const writeRecipe = (filePath: string, recipe: unknown): void => {
  const serialized =
    extname(filePath) === ".json" ? `${JSON.stringify(recipe, null, 2)}\n` : stringifyYaml(recipe);
  writeFileSync(filePath, serialized, "utf8");
};
