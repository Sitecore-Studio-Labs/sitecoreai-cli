import { mediaFieldId } from "../items/guids";
import { type MediaUploadOp, type PushPolicy, type RefValue } from "../ir/operations";
import { createScaiError } from "@/shared/errors";
import { trimEndChar } from "@/shared/strings";
import { type CompileContext } from "./shared";

/**
 * True when an image path/URL is a fully-qualified external URL rather
 * than a media-library path.
 */
export const isExternalMediaUrl = (path: string): boolean => /^https?:\/\//i.test(path);

/**
 * Accumulator for the `MediaUpload` ops a compile emits alongside field
 * values. Callers own ordering: push `mediaOps` into the operation list
 * BEFORE the CreateItem/SetField ops whose `media-xml-ref` values
 * reference them, so the executor captures each media itemId first.
 */
export interface ImageMediaSink {
  policy: PushPolicy;
  mediaOps: MediaUploadOp[];
  /**
   * Media-library folder the uploads land under — from
   * `CompileContext.mediaLibraryRoot`. Unset → the flat
   * `/sitecore/media library/RecipeImages/<site>` fallback.
   */
  mediaLibraryRoot?: string;
  /**
   * Pre-resolved folder from the recipe's `mediaLocation` declaration
   * (see `resolveMediaLocationFolder`). When set it wins over
   * `mediaLibraryRoot` and skips the `<recipeName>/` nesting — the
   * author owns the layout. A per-image `mediaLibraryFolder` still
   * overrides this.
   */
  locationFolder?: string;
  /**
   * Brand image-defaults map (role → external URL) from
   * `CompileContext.imageDefaults` (`--image-defaults <file.json>`).
   * An image value that carries a `role` present in this map
   * materialises the mapped URL instead of its recipe-authored one —
   * the substitution seam that keeps recipes brand-agnostic while an
   * installer supplies brand-appropriate imagery.
   */
  imageDefaults?: Readonly<Record<string, string>>;
}

/**
 * Resolve a recipe's `mediaLocation` declaration to the absolute
 * media-library folder its uploads land under — the media twin of the
 * datasource-locations model. Returns `undefined` when no location is
 * declared (callers fall back to the default `<root>/<recipeName>/`
 * nesting).
 *
 *   - `site`  → `<mediaLibraryRoot>/<subfolder?>`
 *   - `page`  → `<mediaLibraryRoot>/<pageRelativePath>/<subfolder?>` —
 *     only valid where a host page exists; callers that have no page
 *     (content items, template SV defaults) omit `pageRelativePath`
 *     and the compiler rejects the scope with INPUT_INVALID.
 */
export const resolveMediaLocationFolder = (
  location: { scope: "page" | "site"; subfolder?: string } | undefined,
  opts: {
    context: CompileContext;
    site: string;
    recipeHandle: string;
    /** The page item's path relative to `pagesRoot` — page recipes only. */
    pageRelativePath?: string;
  }
): string | undefined => {
  if (!location) return undefined;
  const base = trimEndChar(
    opts.context.mediaLibraryRoot ?? `/sitecore/media library/RecipeImages/${opts.site}`,
    "/"
  );
  if (location.scope === "site") {
    return location.subfolder ? `${base}/${location.subfolder}` : base;
  }
  if (!opts.pageRelativePath) {
    throw createScaiError(
      `Recipe '${opts.recipeHandle}': mediaLocation scope "page" is only valid on a PageRecipe — ` +
        `content items and templates have no host page to mirror.`,
      "INPUT_INVALID",
      { hint: 'Use `mediaLocation: { scope: "site", subfolder: "…" }` here instead.' }
    );
  }
  const pageFolder = `${base}/${opts.pageRelativePath}`;
  return location.subfolder ? `${pageFolder}/${location.subfolder}` : pageFolder;
};

/**
 * Materialise an external image URL as a media-library item: emit (or
 * dedupe onto) a `MediaUpload` op in the sink and return the
 * `media-xml-ref` value the consuming field stores. At apply time the
 * executor uploads the bytes, captures the server-assigned media
 * itemId, and resolves the ref to `<image mediaid="{GUID}" />` — the
 * form Pages' canvas, the Layout Service, and Edge all render.
 *
 * The refKey is deterministic per (site, recipe, field, URL), so the
 * same avatar repeated across languages/versions uploads once, while a
 * story that swaps the image per version gets one media item per URL.
 * The destination basename embeds a refKey fragment so two different
 * URLs on the same field can't collide on one media path (the
 * executor's idempotency lookup would otherwise capture the first
 * upload's item for both).
 *
 * Destination folder resolution, most-specific first:
 *   1. `folder` (the image value's own `mediaLibraryFolder`) — used
 *      as-is; only the generated leaf is appended.
 *   2. `sink.locationFolder` (the recipe's `mediaLocation` declaration,
 *      page- or site-scoped) — used as-is, no `<recipeName>/` nesting.
 *   3. `sink.mediaLibraryRoot` (from `CompileContext.mediaLibraryRoot`,
 *      i.e. env-profile `recipeRoots.mediaLibrary` / `--media-library-root`)
 *      — uploads nest under `<root>/<recipeName>/`.
 *   4. Fallback: `/sitecore/media library/RecipeImages/<site>/<recipeName>/`.
 *
 * **Role-substituted images are SITE-LEVEL, not per-recipe.** When an
 * image-defaults override fires, the media item is a brand default the
 * whole site shares — so its refKey is scoped to (site, role, URL)
 * instead of (site, recipe, field, URL), and it lands under
 * `<root>/Defaults/<role>-<hash>`. Every component/recipe that maps the
 * same role resolves the SAME refKey: within one push the first
 * MediaUpload captures the itemId and later duplicates skip; across
 * pushes the executor's path-based idempotency lookup reuses the
 * existing item. One brand image per role per site, uploaded once.
 */
export const externalImageMediaRef = (opts: {
  site: string;
  recipeHandle: string;
  fieldName: string;
  url: string;
  alt?: string;
  /**
   * Semantic image role — when set AND `substituteRole` is true AND
   * `sink.imageDefaults` maps it, the mapped URL replaces `url` before
   * materialisation (brand substitution). The refKey derives from the
   * EFFECTIVE URL, so two brands' maps yield distinct media items on
   * the same field.
   */
  role?: string;
  /**
   * Opt-in for image-defaults substitution. Set ONLY by the template
   * Standard-Values path — SV defaults are the component's stock
   * imagery, which is exactly what the brand map exists to replace.
   * AUTHORED content values (page/content-item images, exported story
   * imagery) must never be overridden by a role default: the author's
   * value always wins over the standard value.
   */
  substituteRole?: boolean;
  /** Per-value destination folder override (`image.mediaLibraryFolder`). */
  folder?: string;
  sink: ImageMediaSink;
}): RefValue => {
  const { site, recipeHandle, fieldName, alt, folder, sink } = opts;
  const override =
    opts.substituteRole === true && opts.role !== undefined
      ? sink.imageDefaults?.[opts.role]
      : undefined;
  if (override !== undefined && !isExternalMediaUrl(override)) {
    throw createScaiError(
      `Image-defaults entry for role '${opts.role}' is not an http(s) URL: '${override}'.`,
      "INPUT_INVALID",
      { hint: "Image-defaults map values must be fully-qualified external URLs." }
    );
  }
  const url = override ?? opts.url;
  // Brand-substituted images are shared site assets: identity is
  // (site, role, URL) so every consumer of the role converges on one
  // media item in the site's Defaults folder. Recipe-authored images
  // keep the per-(recipe, field) identity and folders documented above.
  const isSiteDefault = override !== undefined && opts.role !== undefined;
  const refKey = isSiteDefault
    ? mediaFieldId(site, "site-image-defaults", opts.role as string, url)
    : mediaFieldId(site, recipeHandle, fieldName, url);
  if (!sink.mediaOps.some((op) => op.id === refKey)) {
    const mediaRoot = trimEndChar(
      sink.mediaLibraryRoot ?? `/sitecore/media library/RecipeImages/${site}`,
      "/"
    );
    const recipeName = recipeHandle.split("@")[0];
    const destinationFolder = isSiteDefault
      ? `${mediaRoot}/Defaults`
      : folder
        ? trimEndChar(folder, "/")
        : sink.locationFolder !== undefined
          ? trimEndChar(sink.locationFolder, "/")
          : `${mediaRoot}/${recipeName}`;
    const leaf = isSiteDefault
      ? `${opts.role}-${refKey.slice(0, 8)}`
      : `${fieldName}-${refKey.slice(0, 8)}`;
    sink.mediaOps.push({
      op: "MediaUpload",
      policy: sink.policy,
      label: isSiteDefault
        ? `media-upload:site-image-defaults:${opts.role}`
        : `media-upload:${recipeHandle}:${fieldName}`,
      id: refKey,
      source: { kind: "external-url", url },
      destinationPath: `${destinationFolder}/${leaf}`,
      ...(alt ? { altText: alt } : {}),
    });
  }
  return { kind: "media-xml-ref", refKey };
};
