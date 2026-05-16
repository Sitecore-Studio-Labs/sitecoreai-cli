/**
 * Registry of recipe kinds — maps a kind name to its `RecipeKind`
 * implementation so the CLI and MCP can dispatch generically.
 *
 * Kinds register themselves at startup via a side-effect import. The
 * stored value type is erased to `unknown` at the registry boundary;
 * callers that know a kind statically should import its `RecipeKind`
 * directly rather than going through `getKind`.
 */
import { createScaiError } from "@/shared/errors";
import type { RecipeKind } from "./kind";

const kinds = new Map<string, RecipeKind<unknown>>();

/** Register a recipe kind. Throws on a duplicate name. */
export const registerKind = <T>(kind: RecipeKind<T>): void => {
  if (kinds.has(kind.name)) {
    throw createScaiError(`Recipe kind '${kind.name}' is already registered`, "UNKNOWN");
  }
  kinds.set(kind.name, kind as unknown as RecipeKind<unknown>);
};

/** Look up a registered kind, or throw a hinted error when it is absent. */
export const getKind = (name: string): RecipeKind<unknown> => {
  const kind = kinds.get(name);
  if (!kind) {
    throw createScaiError(`Unknown recipe kind '${name}'`, "INPUT_INVALID", {
      hint: `Known kinds: ${listKinds().join(", ") || "(none registered)"}`,
    });
  }
  return kind;
};

/** Names of all registered kinds, sorted. */
export const listKinds = (): string[] => [...kinds.keys()].sort();
