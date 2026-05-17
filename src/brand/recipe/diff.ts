/**
 * The pure diff for the `brand-kit` recipe kind — desired recipe vs.
 * captured current state → a `RecipePlan`. No I/O, so it is cheap to
 * unit-test and is the testable core of the kind.
 *
 * Each change carries `meta` so `apply` can act on it without parsing
 * the `path` string:
 *   - kit creation   → `{ stage: "kit", description, industry }`
 *   - document ingest → `{ stage: "document", document }`
 *   - field value     → `{ stage: "field", section, field }`
 *
 * A brand kit's sections/fields are created by the enrichment pipeline,
 * so a kit-absent diff also emits the desired field values as `create`
 * changes — `apply` resolves them once enrichment has populated the kit.
 *
 * See docs/recipe-sync-architecture.md.
 */
import { isDeepStrictEqual } from "node:util";
import type { RecipeChange, RecipePlan } from "@/sync";
import type { BrandKitRecipe } from "./schema";

/** Diff a desired brand-kit recipe against captured current state. */
export const diffBrandKit = (
  desired: BrandKitRecipe,
  current: BrandKitRecipe | null
): RecipePlan => {
  const changes: RecipeChange[] = [];

  if (current === null) {
    changes.push({
      kind: "create",
      path: "kit",
      summary: `Create brand kit "${desired.name}"`,
      after: desired.name,
      meta: { stage: "kit", description: desired.description, industry: desired.industry },
    });
    desired.documents.forEach((document, index) => {
      changes.push({
        kind: "create",
        path: `documents[${index}]`,
        summary: `Upload + ingest ${document.url}`,
        after: document.url,
        meta: { stage: "document", document },
      });
    });
  }

  for (const [section, fields] of Object.entries(desired.sections)) {
    for (const [field, value] of Object.entries(fields)) {
      const path = `sections.${section}.${field}`;
      const meta = { stage: "field", section, field };
      const currentValue = current?.sections[section]?.[field];

      if (current === null || currentValue === undefined) {
        changes.push({
          kind: "create",
          path,
          summary: `${section} / ${field}`,
          after: value,
          meta,
        });
      } else if (isDeepStrictEqual(currentValue, value)) {
        changes.push({ kind: "noop", path, summary: `${section} / ${field} unchanged`, meta });
      } else {
        changes.push({
          kind: "update",
          path,
          summary: `${section} / ${field}`,
          before: currentValue,
          after: value,
          meta,
        });
      }
    }
  }

  return { changes };
};
