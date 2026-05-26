/**
 * The recipe kinds the cross-domain aggregate (`scai sync` / the
 * `recipe_sync` MCP tool) fans out over.
 *
 * `aggregate.ts` is deliberately domain-free so the engine never cycles
 * with `@/brand` / `@/brief`. This file is the single, deliberately
 * domain-AWARE exception: it names the concrete kinds the aggregate
 * covers, so the CLI command and the MCP tool import ONE list instead
 * of each hand-maintaining their own copy (the drift that let `sync`
 * coverage diverge between the two surfaces).
 *
 * Not re-exported from `./index` — importing the barrel must stay
 * domain-free. Consumers import this module by its explicit path.
 *
 * Only kinds that implement `RecipeKind.list` (can enumerate their own
 * instances) belong here. File-authored component/page/site recipes
 * have nothing to enumerate and stay with `provision recipe`.
 */
import { brandKitKind } from "@/brand/recipe";
import { briefInstanceKind, briefTypeKind } from "@/brief/recipe";
import type { RecipeKind } from "@/sync";

/**
 * Every enumerable recipe kind, in display order. Add a row when a new
 * kind ships a `list` implementation — both `scai sync` and the
 * `recipe_sync` MCP tool pick it up automatically.
 */
export const ENUMERABLE_RECIPE_KINDS: ReadonlyArray<RecipeKind<unknown>> = [
  brandKitKind as RecipeKind<unknown>,
  briefTypeKind as RecipeKind<unknown>,
  briefInstanceKind as RecipeKind<unknown>,
];
