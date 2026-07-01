import { z } from "zod";
import { FolderPath, HANDLE_PATTERN } from "../shared";

/**
 * One value in an `EnumerationRecipe`. Compiles to a Sitecore item that
 * conforms to the per-site `Enumeration Value` template (NOT the
 * `Enumeration` template — that one is for the per-enum container).
 * `Enumeration Value` carries an `Enumeration` Template Section with a
 * single `Value` Single-Line Text shared field — see
 * `EnumerationRecipeSchema` for the full template structure.
 *
 *   `name`         — Sitecore item name and uuidv5 GUID seed for the
 *                    value item. Load-bearing: renaming `name` creates
 *                    a *different* value item and orphans every
 *                    existing reference. Also written to the `Value`
 *                    shared field on the value item, which is what
 *                    SXA-aware consumers (XM Cloud Pages, JSS variants,
 *                    custom Edge resolvers) read via the canonical
 *                    "picked item's Value field" pattern.
 *   `displayName`  — `__Display name` on the item, defaults to `name`.
 *                    What the editor's Droplink dropdown shows. Use
 *                    this to change the visible label without touching
 *                    `name`.
 *   `description`  — optional per-value guidance: *when to pick this
 *                    value over its siblings*. Lands on the value
 *                    item's `__Help text` field (surfaces in the
 *                    Content Editor tooltip) AND travels in the
 *                    published recipe JSON, so an agent composing a
 *                    page has the discriminating context a bare
 *                    `displayName` can't carry (e.g. why choose
 *                    `link-arrow` over `link`). `displayName` labels
 *                    the option; `description` says when to use it.
 */
export const EnumerationValueSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});

export type EnumerationValue = z.infer<typeof EnumerationValueSchema>;

/**
 * A reusable enumeration — backs Droplink fields whose options are
 * shared across multiple components (color schemes, size scales,
 * spacing scales, etc.). Each value lands as a child item under
 * `<enumerationsRoot>/[<subfolder>/]<EnumName>/<ValueName>`.
 *
 * Reference from any field via `sitecore.enumHandle: "<handle>"`. On
 * re-push, adding a value to the enumeration surfaces it on every
 * referencing field automatically (the Droplink Source resolves by
 * location at editor time, so consumer field-definitions don't need
 * to change).
 *
 * Underlying template structure (emitted once per site by
 * `ensureEnumerationTemplates` — three distinct templates, each with
 * its own role; never collapsed):
 *
 *   Enumerations Folder            (Template — folder layers in the
 *                                   enum content tree: site enumerations
 *                                   root + per-folder grouping items)
 *     └── __Standard Values        Insert Options:
 *                                    Enumeration, Enumerations Folder
 *
 *   Enumeration                    (Template — per-enum CONTAINER items
 *                                   like `Color Scheme`, `Heading Size`)
 *     └── __Standard Values        Insert Options: Enumeration Value
 *
 *   Enumeration Value              (Template — leaf VALUE items like
 *                                   `primary`, `accent`, `lg`)
 *     └── Enumeration              (Template Section)
 *           └── Value               (Single-Line Text, shared)
 *
 * Each value item conforms to `Enumeration Value` and stores its `name`
 * on the `Value` shared field. That payload is what Droplink consumers
 * read via the SXA "picked item's Value field" pattern — without it,
 * components wired against the enum stay empty.
 *
 * The matching consumer-side surface is `Type=Droplink` (the default
 * for `shape: "enum"`). Inline Droplink (`shape: "enum"` with `values`
 * but no `enumHandle`) is unsupported — authors must either point at
 * an EnumerationRecipe via `enumHandle` or override `sitecore.type` to
 * `"droplist"` for an inline pipe-list dropdown.
 */
export const EnumerationRecipeSchema = z.object({
  kind: z.literal("enumeration"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN),
  /** Item name under `<enumerationsRoot>` (e.g. `ColorScheme`). */
  name: z.string().min(1),
  /** Author-facing label (defaults to `name` when omitted). */
  displayName: z.string().min(1).optional(),
  description: z.string().optional(),
  /**
   * Optional placement of the enum's items in the content tree. Mirrors
   * the `scope` + `folder` shape used by component
   * `rendering.datasource.locations`, but kept SINGULAR (`location`,
   * not `locations`) — an enum's value items live in exactly one place
   * by construction, so multi-location dual identity isn't a thing.
   *
   *   scope: "site"           → under the site's enumerations root.
   *   scope: "siteCollection" → reserved for shared-vocabulary use
   *                             (not yet implemented; throws
   *                             INPUT_INVALID at compile time).
   *   folder                  → optional grouping segment(s) under the
   *                             scope root. Materialised as `CreateOnly`
   *                             items conforming to the per-site
   *                             `Enumerations Folder` template. Multiple
   *                             recipes naming the same folder share it,
   *                             not collide. Multi-segment paths like
   *                             `"Theme/Color"` work too — splits on
   *                             `/`, intermediate segments emit one
   *                             grouping item each.
   *
   * Omit `location` entirely → enum lands flat at the site enumerations
   * root, no grouping folder.
   */
  location: z
    .object({
      scope: z.enum(["site", "siteCollection"]),
      folder: FolderPath.optional(),
    })
    .optional(),
  values: z.array(EnumerationValueSchema).min(1),
  /**
   * Default value for this enumeration. Compiled into the per-enum
   * container item's `Value` shared field so Edge consumers querying
   * the container directly receive a default when the picker hasn't
   * been bound yet (the canonical Sitecore "carry the default on the
   * enumeration item itself" pattern).
   *
   * Must match one of `values[].name`. Validated by
   * `compileEnumerationRecipe` at compile time (cross-field validation
   * can't go on the schema itself — `discriminatedUnion` doesn't accept
   * `ZodEffects` members). Optional — omit to leave the default empty
   * (consumers fall back to component-level defaults).
   */
  default: z.string().min(1).optional(),
});

export type EnumerationRecipe = z.input<typeof EnumerationRecipeSchema>;
