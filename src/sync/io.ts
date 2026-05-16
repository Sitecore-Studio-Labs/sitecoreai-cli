/**
 * Recipe file I/O for the `sync` engine — load a recipe from a YAML or
 * JSON file and validate it against a kind's schema, or serialize a
 * captured recipe back to disk.
 *
 * See docs/recipe-sync-architecture.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ZodType } from "zod";
import { createScaiError } from "@/shared/errors";

/**
 * Read, parse, and schema-validate a recipe file. YAML is a superset of
 * JSON, so `.yaml`, `.yml`, and `.json` all parse through the same path.
 */
export const loadRecipe = <T>(filePath: string, schema: ZodType<T>): T => {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw createScaiError(`Cannot read recipe file "${filePath}"`, "INPUT_INVALID", {
      hint: error instanceof Error ? error.message : undefined,
    });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw createScaiError(`Recipe file "${filePath}" is not valid YAML/JSON`, "INPUT_INVALID", {
      hint: error instanceof Error ? error.message : undefined,
    });
  }

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

/** Serialize a recipe to a file — JSON when the path ends `.json`, else YAML. */
export const writeRecipe = (filePath: string, recipe: unknown): void => {
  const serialized =
    extname(filePath) === ".json"
      ? `${JSON.stringify(recipe, null, 2)}\n`
      : stringifyYaml(recipe);
  writeFileSync(filePath, serialized, "utf8");
};
