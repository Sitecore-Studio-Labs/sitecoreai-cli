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
 *   - section property → `{ stage: "sectionProperty", section, sourceLanguage }`
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
      // The discriminated union has two shapes — `url` carries a URL,
      // `registry-file` carries a `path`. The diff describes the
      // change in human terms only; the apply step is where the
      // registry-file → URL contract is enforced.
      const label = document.kind === "url" ? document.url : `registry-file:${document.path}`;
      changes.push({
        kind: "create",
        path: `documents[${index}]`,
        summary: `Upload + ingest ${label}`,
        after: label,
        meta: { stage: "document", document },
      });
    });
  }

  // Logo is a kit-level URL field, set via a PATCH (`updateBrandKitLogo`)
  // regardless of whether the kit was just created or already exists.
  // Only emit a change when the recipe declares a logo and it differs —
  // an omitted `logo` leaves the live value unmanaged (no clear).
  if (desired.logo !== undefined && desired.logo !== current?.logo) {
    changes.push({
      kind: current === null ? "create" : "update",
      path: "logo",
      summary: `Set brand kit logo`,
      before: current?.logo,
      after: desired.logo,
      meta: { stage: "logo" },
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

  // Section-level properties (today only Glossary's `sourceLanguage`). The
  // Sitecore AI app gates the Glossary terms table behind a section-level
  // source language — without it, term fields persist but the UI renders an
  // empty state, so the values never appear. Emit a change when the recipe
  // declares a `sourceLanguage` that the live section lacks or differs from;
  // an omitted value leaves the live one unmanaged (no clear).
  // `sectionProperties` is schema-defaulted to `{}`, but the merged recipe
  // built by the policy merge can omit it — guard against undefined.
  for (const [section, properties] of Object.entries(desired.sectionProperties ?? {})) {
    const sourceLanguage = properties.sourceLanguage;
    if (sourceLanguage === undefined) continue;
    const currentSourceLanguage = current?.sectionProperties?.[section]?.sourceLanguage;
    if (sourceLanguage === currentSourceLanguage) continue;
    changes.push({
      kind: current === null || currentSourceLanguage === undefined ? "create" : "update",
      path: `sectionProperties.${section}.sourceLanguage`,
      summary: `${section} source language → ${sourceLanguage}`,
      before: currentSourceLanguage,
      after: sourceLanguage,
      meta: { stage: "sectionProperty", section, sourceLanguage },
    });
  }

  return { changes };
};
