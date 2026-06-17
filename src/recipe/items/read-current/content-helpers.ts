/**
 * Per-(language, version) content-decoding helpers shared by the two
 * content-bearing reverse-projection families: pages (`project-pages.ts`)
 * and content items (`project-content.ts`). Both fan a per-language read
 * (`getItemPerLanguageBatch`) plus a historic per-version read
 * (`getItemAtVersionsBatch`) into one round trip each, then decode the
 * resulting snapshots into the recipe's `{ fieldName → ContentFieldValue }`
 * shape bucketed by storage axis.
 *
 * See `../read-current.ts` for the module-level contract.
 */

import type { AuthoringApiClient, RemoteItem } from "../../api/client";
import type { ContentFieldValue } from "../../schema/recipe";
import { decodeContentFieldValue, decodeSitecoreDateToIso } from "./decode";
import {
  authorableFieldsOf,
  fieldValueByName,
  type GuidHandleIndex,
  type TemplateFieldShapes,
} from "./helpers";

/**
 * Decode the per-(lang, version) authorable field values for one snapshot
 * into the recipe's `{ fieldName → ContentFieldValue }` shape. Fields whose
 * name doesn't resolve to a known shape (template hasn't been walked, or
 * a non-template field) are skipped — we'd be guessing the shape.
 */
export const decodeVersionedFieldsOf = (
  snapshot: RemoteItem,
  shapes: TemplateFieldShapes,
  guidIndex: GuidHandleIndex
): Record<string, ContentFieldValue> => {
  const out: Record<string, ContentFieldValue> = {};
  for (const f of authorableFieldsOf(snapshot)) {
    // Versioned-bucket fields only: shared values surface separately
    // (they're already split by storage on the template-shape map).
    if (f.language === undefined && f.version === undefined) continue;
    if (f.name === undefined) continue;
    const info = shapes.get(f.name.toLowerCase());
    if (info === undefined) continue;
    if (info.storage === "shared") continue;
    const decoded = decodeContentFieldValue(f.value, info.shape, guidIndex);
    if (decoded !== null) out[f.name] = decoded;
  }
  return out;
};

/**
 * Decode the item-level `storage: shared` fields. Aggregated across pass 1's
 * results — shared values are language-agnostic, so the first occurrence
 * wins. (`storage: unversioned` is treated as `versioned` from the recipe's
 * perspective: it lives per-language and round-trips as a translation/version
 * field, not a shared one.)
 */
export const collectSharedFields = (
  populated: ReadonlyArray<{ item: RemoteItem | null }>,
  shapes: TemplateFieldShapes,
  guidIndex: GuidHandleIndex
): Record<string, ContentFieldValue> => {
  const sharedFields: Record<string, ContentFieldValue> = {};
  for (const row of populated) {
    const snapshot = row.item;
    if (!snapshot) continue;
    for (const f of authorableFieldsOf(snapshot)) {
      if (f.language !== undefined || f.version !== undefined) continue;
      if (f.name === undefined || f.name in sharedFields) continue;
      const info = shapes.get(f.name.toLowerCase());
      if (info === undefined || info.storage !== "shared") continue;
      const decoded = decodeContentFieldValue(f.value, info.shape, guidIndex);
      if (decoded !== null) sharedFields[f.name] = decoded;
    }
  }
  return sharedFields;
};

/** Read the per-version `__Created` date and decode to ISO datetime. */
export const dateOfSnapshot = (snapshot: RemoteItem): string | undefined => {
  const raw = fieldValueByName(snapshot, "__Created");
  if (raw === undefined || raw === "") return undefined;
  return decodeSitecoreDateToIso(raw, "datetime");
};

/**
 * Per-(language, version) historic snapshot fan-out. Requests every version
 * below each language's latest (the latest came back in pass 1) in a single
 * batched round trip, then indexes the results by `language|version`.
 */
export const fetchHistoricSnapshots = async (
  item: RemoteItem,
  populated: ReadonlyArray<{ language: string; versions: number[] }>,
  client: AuthoringApiClient
): Promise<Map<string, RemoteItem>> => {
  const historicRequests: Array<{ language: string; version: number }> = [];
  for (const row of populated) {
    for (const v of row.versions) {
      // The latest version came back in pass 1; only fetch the ones below it.
      if (v < row.versions[row.versions.length - 1]) {
        historicRequests.push({ language: row.language, version: v });
      }
    }
  }
  const historic =
    historicRequests.length > 0
      ? await client.getItemAtVersionsBatch({ itemId: item.itemId }, historicRequests)
      : [];
  const historicByLangVer = new Map<string, RemoteItem>();
  for (let i = 0; i < historicRequests.length; i += 1) {
    const snap = historic[i];
    if (snap)
      historicByLangVer.set(`${historicRequests[i].language}|${historicRequests[i].version}`, snap);
  }
  return historicByLangVer;
};
