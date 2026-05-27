/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/content`.
 *
 * Content-state controls — per-version mutations on Sitecore's
 * publish-state fields (`__Never publish`, `__Valid from`, `__Valid
 * to`) and the read-only `inspect` helper. Lives separate from
 * `./publishing` because these are CM-side mutations that don't (by
 * themselves) call the Publishing API — operators run `scai content publish
 * item` after their content-state changes.
 */

// --- Authoring GraphQL helpers ----------------------------------------
export {
  FIELD_NEVER_PUBLISH,
  FIELD_VALID_FROM,
  FIELD_VALID_TO,
  PUBLISH_STATE_FIELDS,
  SITECORE_BOOLEAN_FALSE,
  SITECORE_BOOLEAN_TRUE,
  findField,
  formatBoolean,
  parseBoolean,
  readVersionFields,
  resolveSinglePathToId,
  writeVersionFields,
  type PublishStateFieldName,
  type ReadVersionFieldsOptions,
  type VersionFieldsSnapshot,
  type VersionFieldValue,
  type WriteVersionFieldsOptions,
} from "./api/version-fields";

// --- Target resolution --------------------------------------------------
// `resolveTargetItemId` turns an `--item-id` *or* `--path` into a
// canonical item id — the presentation-free target-resolution step the
// content-version runners share.
export { resolveTargetItemId } from "./tasks/shared";

// --- Task runners -------------------------------------------------------
export {
  runContentVersionSetNeverPublish,
  type RunContentVersionSetNeverPublishOptions,
} from "./tasks/version-never-publish";

export {
  runContentVersionSetValidity,
  type RunContentVersionSetValidityOptions,
} from "./tasks/version-validity";

export { runContentVersionGet, type RunContentVersionGetOptions } from "./tasks/version-get";
