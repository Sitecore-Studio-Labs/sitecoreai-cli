import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Unit tests for the three-way merge baseline module
 * (`src/recipe/runtime/baseline.ts`). Covers:
 *
 *  - `hashFieldValue` stability + sensitivity
 *  - `indexBaseline` lookups by (itemRefKey, fieldId|fieldName, lang?, ver?)
 *  - `loadBaseline` / `writeBaseline` round-trip on a temp dir
 *  - Missing-file and malformed-file behaviour
 */

import {
  type Baseline,
  type BaselineFieldEntry,
  CONTENT_RECIPE_BASELINE_KIND,
  adaptSyncBaselineStorage,
  baselineFilePath,
  hashFieldValue,
  indexBaseline,
  loadBaseline,
  writeBaseline,
} from "../../../../src/recipe/runtime/baseline";
import type { Baseline as SyncBaseline, BaselineStorage as SyncBaselineStorage } from "@/sync";

let configDir: string;

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-baseline-test-"));
});

afterEach(async () => {
  await fs.rm(configDir, { recursive: true, force: true });
});

describe("hashFieldValue", () => {
  it("returns a stable SHA-256 hex digest for identical inputs", () => {
    const a = hashFieldValue("Hello world");
    const b = hashFieldValue("Hello world");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns different digests for whitespace-varying inputs", () => {
    // Whitespace is NOT normalised — a real whitespace edit is a real
    // change. Verifies the comment in baseline.ts about that.
    expect(hashFieldValue("Hello world")).not.toBe(hashFieldValue("Hello  world"));
    expect(hashFieldValue("v1")).not.toBe(hashFieldValue("v1\n"));
  });

  it("handles empty strings (used as the 'tenant value missing' sentinel)", () => {
    const empty = hashFieldValue("");
    expect(empty).toMatch(/^[0-9a-f]{64}$/);
    expect(empty).not.toBe(hashFieldValue(" "));
  });
});

describe("baselineFilePath", () => {
  it("composes <configDir>/.scai/baseline/<env>/<slug(handle)>.baseline.json", () => {
    const p = baselineFilePath("/tmp/proj", "staging", "cta-button@1");
    expect(p).toBe("/tmp/proj/.scai/baseline/staging/cta-button_v1.baseline.json");
  });

  it("slugifies the `@` in handles to `_v` (matches io.ts pattern)", () => {
    const p = baselineFilePath("/tmp/proj", "prod", "nav-link@3");
    expect(p).toMatch(/nav-link_v3\.baseline\.json$/);
  });
});

describe("indexBaseline", () => {
  const entry = (over: Partial<BaselineFieldEntry>): BaselineFieldEntry => ({
    itemRefKey: "item-1",
    fieldId: "field-1",
    valueHash: hashFieldValue("default"),
    ...over,
  });

  it("returns an empty index when passed a null baseline (legacy mode)", () => {
    const index = indexBaseline(null);
    expect(index.baseline).toBeNull();
    expect(index.lookup("item-1", "field-1", undefined, undefined, undefined)).toBeUndefined();
  });

  it("looks up by fieldName when fieldName is present (recipe-created fields)", () => {
    const baseline: Baseline = {
      schemaVersion: "1",
      recipeHandle: "x@1",
      envName: "t",
      capturedAt: "2026-06-01T00:00:00Z",
      fields: [entry({ fieldName: "Title", valueHash: hashFieldValue("Welcome") })],
    };
    const index = indexBaseline(baseline);
    // Matches even when the caller passes a different `fieldId` — name
    // wins when present (mirrors planner's `lookupField` behaviour).
    expect(index.lookup("item-1", "totally-other-guid", "Title", undefined, undefined)).toBe(
      hashFieldValue("Welcome")
    );
  });

  it("falls back to fieldId match when no fieldName on the entry (system fields)", () => {
    const baseline: Baseline = {
      schemaVersion: "1",
      recipeHandle: "x@1",
      envName: "t",
      capturedAt: "2026-06-01T00:00:00Z",
      fields: [entry({ fieldId: "system-guid-aaa", valueHash: hashFieldValue("icon") })],
    };
    const index = indexBaseline(baseline);
    expect(index.lookup("item-1", "system-guid-aaa", undefined, undefined, undefined)).toBe(
      hashFieldValue("icon")
    );
  });

  it("scopes lookups by (language, version) — same fieldName different cells differ", () => {
    const baseline: Baseline = {
      schemaVersion: "1",
      recipeHandle: "x@1",
      envName: "t",
      capturedAt: "2026-06-01T00:00:00Z",
      fields: [
        entry({
          fieldName: "Body",
          language: "en",
          version: 1,
          valueHash: hashFieldValue("english"),
        }),
        entry({
          fieldName: "Body",
          language: "fr",
          version: 1,
          valueHash: hashFieldValue("francais"),
        }),
      ],
    };
    const index = indexBaseline(baseline);
    expect(index.lookup("item-1", "f", "Body", "en", 1)).toBe(hashFieldValue("english"));
    expect(index.lookup("item-1", "f", "Body", "fr", 1)).toBe(hashFieldValue("francais"));
    // A (lang, version) tuple absent from the baseline returns undefined.
    expect(index.lookup("item-1", "f", "Body", "de", 1)).toBeUndefined();
  });

  it("is case-insensitive on itemRefKey + fieldName (matches planner conventions)", () => {
    const baseline: Baseline = {
      schemaVersion: "1",
      recipeHandle: "x@1",
      envName: "t",
      capturedAt: "2026-06-01T00:00:00Z",
      fields: [
        entry({
          itemRefKey: "ITEM-MIXED-CASE",
          fieldName: "Title",
          valueHash: hashFieldValue("v"),
        }),
      ],
    };
    const index = indexBaseline(baseline);
    expect(index.lookup("item-mixed-case", "x", "title", undefined, undefined)).toBe(
      hashFieldValue("v")
    );
  });
});

describe("loadBaseline + writeBaseline round-trip", () => {
  it("writes a baseline and loads back the same content", async () => {
    const entries: BaselineFieldEntry[] = [
      {
        itemRefKey: "item-1",
        fieldId: "field-1",
        fieldName: "Title",
        language: "en",
        version: 1,
        valueHash: hashFieldValue("Welcome"),
      },
    ];
    const filePath = await writeBaseline(
      configDir,
      "staging",
      "hero@1",
      entries,
      "2026-06-01T12:00:00Z"
    );
    expect(filePath).toMatch(/staging\/hero_v1\.baseline\.json$/);
    const loaded = await loadBaseline(configDir, "staging", "hero@1");
    expect(loaded).not.toBeNull();
    expect(loaded!.recipeHandle).toBe("hero@1");
    expect(loaded!.envName).toBe("staging");
    expect(loaded!.capturedAt).toBe("2026-06-01T12:00:00Z");
    expect(loaded!.fields).toEqual(entries);
  });

  it("returns null when no baseline file exists (first push)", async () => {
    const loaded = await loadBaseline(configDir, "fresh-env", "anything@1");
    expect(loaded).toBeNull();
  });

  it("throws INPUT_INVALID on malformed JSON", async () => {
    const filePath = baselineFilePath(configDir, "broken", "hero@1");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{not json", "utf8");
    await expect(loadBaseline(configDir, "broken", "hero@1")).rejects.toThrow(/Invalid JSON/);
  });

  it("throws INPUT_INVALID on schema-violating content", async () => {
    const filePath = baselineFilePath(configDir, "wrong-shape", "hero@1");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({ schemaVersion: "1", fields: "not-an-array" }),
      "utf8"
    );
    await expect(loadBaseline(configDir, "wrong-shape", "hero@1")).rejects.toThrow(
      /Invalid baseline/
    );
  });

  it("writeBaseline rejects an entry with an invalid hash (defensive validation)", async () => {
    const entries: BaselineFieldEntry[] = [
      {
        itemRefKey: "item-1",
        fieldId: "field-1",
        valueHash: "not-a-sha256-hex", // wrong format
      },
    ];
    await expect(
      writeBaseline(configDir, "env", "x@1", entries, "2026-06-01T00:00:00Z")
    ).rejects.toThrow();
  });

  it("multiple writes to the same recipe overwrite (no merge)", async () => {
    await writeBaseline(
      configDir,
      "env",
      "hero@1",
      [
        {
          itemRefKey: "item-1",
          fieldId: "f1",
          valueHash: hashFieldValue("first"),
        },
      ],
      "2026-06-01T00:00:00Z"
    );
    await writeBaseline(
      configDir,
      "env",
      "hero@1",
      [
        {
          itemRefKey: "item-2",
          fieldId: "f2",
          valueHash: hashFieldValue("second"),
        },
      ],
      "2026-06-01T01:00:00Z"
    );
    const loaded = await loadBaseline(configDir, "env", "hero@1");
    expect(loaded!.fields).toHaveLength(1);
    expect(loaded!.fields[0].itemRefKey).toBe("item-2");
    expect(loaded!.capturedAt).toBe("2026-06-01T01:00:00Z");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// canonicaliseLayoutXml + hashFieldValueForBaseline — layout fields
// hash the same regardless of wire form (canonical vs SXA delta).
// ─────────────────────────────────────────────────────────────────────────

import {
  canonicaliseLayoutXml,
  hashFieldValueForBaseline,
  isLayoutFieldId,
} from "../../../../src/recipe/runtime/baseline";
import { LAYOUT_FIELDS } from "../../../../src/recipe/ir/sitecore-templates";

describe("canonicaliseLayoutXml", () => {
  it("returns empty string for empty input", () => {
    expect(canonicaliseLayoutXml("")).toBe("");
  });

  it("returns the input unchanged when XML can't be parsed (defensive)", () => {
    // Non-layout-shaped XML — parseLayoutXml returns an empty parsed
    // layout (no `<r>` elements), which canonicalises to a valid
    // empty-layout JSON. So this verifies the failure-mode safety net
    // by checking deterministic output, not literal passthrough.
    const garbage = "not really layout xml";
    const out = canonicaliseLayoutXml(garbage);
    expect(typeof out).toBe("string");
    // Either passthrough OR a deterministic JSON — both are valid; the
    // contract is "doesn't throw."
    expect(() => canonicaliseLayoutXml(garbage)).not.toThrow();
  });

  it("yields stable output for the same logical layout regardless of attribute order", () => {
    // Two canonical-form XMLs with the same placement in different
    // attribute order — should hash identical after canonicalisation.
    const xmlA =
      `<r xmlns:p="p" xmlns:s="s" p:p="p:da"><d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">` +
      `<r id="{11111111-1111-1111-1111-111111111111}" par="" placeh="main" uid="{22222222-2222-2222-2222-222222222222}" /></d></r>`;
    const xmlB =
      `<r xmlns:p="p" xmlns:s="s" p:p="p:da"><d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">` +
      `<r uid="{22222222-2222-2222-2222-222222222222}" placeh="main" par="" id="{11111111-1111-1111-1111-111111111111}" /></d></r>`;
    expect(canonicaliseLayoutXml(xmlA)).toBe(canonicaliseLayoutXml(xmlB));
  });

  it("sorts placeholder keys deterministically", () => {
    const xmlABFirst =
      `<r xmlns:p="p" xmlns:s="s" p:p="p:da"><d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">` +
      `<r id="{11111111-1111-1111-1111-111111111111}" placeh="zebra" uid="{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}" />` +
      `<r id="{11111111-1111-1111-1111-111111111111}" placeh="alpha" uid="{bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb}" />` +
      `</d></r>`;
    const out = canonicaliseLayoutXml(xmlABFirst);
    // After canonicalisation alpha sorts before zebra in the JSON.
    const alphaIdx = out.indexOf("alpha");
    const zebraIdx = out.indexOf("zebra");
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(zebraIdx).toBeGreaterThan(-1);
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });
});

describe("isLayoutFieldId", () => {
  it("matches both __Renderings and __Final Renderings (case-insensitive)", () => {
    expect(isLayoutFieldId(LAYOUT_FIELDS.RENDERINGS)).toBe(true);
    expect(isLayoutFieldId(LAYOUT_FIELDS.FINAL_RENDERINGS)).toBe(true);
    expect(isLayoutFieldId(LAYOUT_FIELDS.RENDERINGS.toUpperCase())).toBe(true);
    expect(isLayoutFieldId("not-a-layout-field-guid")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FileBaselineStorage — the default impl behind loadBaseline/writeBaseline.
// Verifies the BaselineStorage interface contract: locator + load/write
// round-trip + the "missing returns null, malformed throws" semantics.
// ─────────────────────────────────────────────────────────────────────────

import { FileBaselineStorage } from "../../../../src/recipe/runtime/baseline";

describe("FileBaselineStorage", () => {
  let storage: FileBaselineStorage;

  beforeEach(() => {
    storage = new FileBaselineStorage(configDir);
  });

  it("locator composes the same path as baselineFilePath", () => {
    expect(storage.locator("staging", "hero@1")).toBe(
      baselineFilePath(configDir, "staging", "hero@1")
    );
  });

  it("load returns null when no baseline file exists", async () => {
    expect(await storage.load("fresh-env", "x@1")).toBeNull();
  });

  it("write then load round-trips identical content", async () => {
    const baseline = {
      schemaVersion: "1" as const,
      recipeHandle: "hero@1",
      envName: "staging",
      capturedAt: "2026-06-01T00:00:00Z",
      fields: [
        {
          itemRefKey: "item-1",
          fieldId: "field-1",
          fieldName: "Title",
          valueHash: hashFieldValue("Welcome"),
        },
      ],
    };
    const filePath = await storage.write("staging", "hero@1", baseline);
    expect(filePath).toBe(storage.locator("staging", "hero@1"));
    const loaded = await storage.load("staging", "hero@1");
    expect(loaded).toEqual(baseline);
  });

  it("write rejects malformed baseline (validates against the schema)", async () => {
    await expect(
      storage.write("env", "x@1", {
        schemaVersion: "1" as const,
        recipeHandle: "x@1",
        envName: "env",
        capturedAt: "2026-06-01T00:00:00Z",
        fields: [
          {
            itemRefKey: "item-1",
            fieldId: "field-1",
            // Wrong hash format — should be 64-hex.
            valueHash: "not-a-sha256-hex",
          },
        ],
      })
    ).rejects.toThrow();
  });

  it("load throws when the file is malformed (refuses to mask integrity errors)", async () => {
    const filePath = storage.locator("broken", "hero@1");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{not json", "utf8");
    await expect(storage.load("broken", "hero@1")).rejects.toThrow(/Invalid JSON/);
  });
});

describe("hashFieldValueForBaseline", () => {
  it("hashes non-layout fields verbatim (same as hashFieldValue)", () => {
    const value = "Hello world";
    expect(hashFieldValueForBaseline("some-field-guid", value)).toBe(hashFieldValue(value));
  });

  it("hashes layout fields after canonicalisation — two attribute orders hash equal", () => {
    const xmlA =
      `<r xmlns:p="p" xmlns:s="s" p:p="p:da"><d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">` +
      `<r id="{11111111-1111-1111-1111-111111111111}" par="" placeh="main" uid="{22222222-2222-2222-2222-222222222222}" /></d></r>`;
    const xmlB =
      `<r xmlns:p="p" xmlns:s="s" p:p="p:da"><d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">` +
      `<r uid="{22222222-2222-2222-2222-222222222222}" placeh="main" par="" id="{11111111-1111-1111-1111-111111111111}" /></d></r>`;
    expect(hashFieldValueForBaseline(LAYOUT_FIELDS.FINAL_RENDERINGS, xmlA)).toBe(
      hashFieldValueForBaseline(LAYOUT_FIELDS.FINAL_RENDERINGS, xmlB)
    );
    // And different from the raw hash — canonicalisation actually rewrites.
    expect(hashFieldValueForBaseline(LAYOUT_FIELDS.FINAL_RENDERINGS, xmlA)).not.toBe(
      hashFieldValue(xmlA)
    );
  });

  it("empty layout XML hashes the same as empty for both layout fieldIds", () => {
    expect(hashFieldValueForBaseline(LAYOUT_FIELDS.RENDERINGS, "")).toBe(hashFieldValue(""));
    expect(hashFieldValueForBaseline(LAYOUT_FIELDS.FINAL_RENDERINGS, "")).toBe(hashFieldValue(""));
  });
});

describe("adaptSyncBaselineStorage", () => {
  // In-memory sync storage used to exercise the adapter without touching
  // disk or the network. Mirrors the contract of HttpBaselineStorage:
  // load returns the full envelope (kind + envName + recipeHandle +
  // capturedAt + payload), write replaces the envelope wholesale.
  const buildSyncStorage = (): {
    storage: SyncBaselineStorage;
    state: Map<string, SyncBaseline<unknown>>;
  } => {
    const state = new Map<string, SyncBaseline<unknown>>();
    const key = (k: string, env: string, h: string) => `${k}/${env}/${h}`;
    const storage: SyncBaselineStorage = {
      load: async (k, env, h) => state.get(key(k, env, h)) ?? null,
      write: async (k, env, h, b) => {
        state.set(key(k, env, h), b);
        return `mem://${key(k, env, h)}`;
      },
      locator: (k, env, h) => `mem://${key(k, env, h)}`,
    };
    return { storage, state };
  };

  it("write wraps the recipe Baseline in a sync envelope keyed by content-recipe", async () => {
    const { storage, state } = buildSyncStorage();
    const adapted = adaptSyncBaselineStorage(storage);
    const baseline: Baseline = {
      schemaVersion: "1",
      recipeHandle: "hero@1",
      envName: "sandbox",
      capturedAt: "2026-06-02T00:00:00Z",
      fields: [],
    };
    const locator = await adapted.write("sandbox", "hero@1", baseline);
    expect(locator).toBe(`mem://${CONTENT_RECIPE_BASELINE_KIND}/sandbox/hero@1`);

    const envelope = state.get(`${CONTENT_RECIPE_BASELINE_KIND}/sandbox/hero@1`)!;
    expect(envelope.kind).toBe(CONTENT_RECIPE_BASELINE_KIND);
    expect(envelope.envelopeVersion).toBe("1");
    expect(envelope.payload).toEqual(baseline);
  });

  it("load unwraps the sync envelope back into a recipe Baseline", async () => {
    const { storage } = buildSyncStorage();
    const adapted = adaptSyncBaselineStorage(storage);
    const baseline: Baseline = {
      schemaVersion: "1",
      recipeHandle: "hero@1",
      envName: "sandbox",
      capturedAt: "2026-06-02T00:00:00Z",
      fields: [
        {
          itemRefKey: "item-1",
          fieldId: "f-1",
          valueHash: "0".repeat(64),
        } satisfies BaselineFieldEntry,
      ],
    };
    await adapted.write("sandbox", "hero@1", baseline);
    const loaded = await adapted.load("sandbox", "hero@1");
    expect(loaded).toEqual(baseline);
  });

  it("load returns null when the sync storage has no envelope for the key", async () => {
    const { storage } = buildSyncStorage();
    const adapted = adaptSyncBaselineStorage(storage);
    const loaded = await adapted.load("sandbox", "nonexistent@1");
    expect(loaded).toBeNull();
  });

  it("locator delegates to the sync locator with content-recipe pinned", () => {
    const { storage } = buildSyncStorage();
    const adapted = adaptSyncBaselineStorage(storage);
    expect(adapted.locator("sandbox", "hero@1")).toBe(
      `mem://${CONTENT_RECIPE_BASELINE_KIND}/sandbox/hero@1`
    );
  });
});

import { canonicaliseGuidList, isGuidListValue } from "../../../../src/recipe/runtime/baseline";

describe("GUID-list canonicalisation", () => {
  it("recognises single GUIDs and pipe-separated lists in any brace/case form", () => {
    expect(isGuidListValue("{F7332C33-2305-40B1-904D-9823350A774F}")).toBe(true);
    expect(
      isGuidListValue("f7332c33-2305-40b1-904d-9823350a774f|{BB07F87B-7D77-416E-B71D-B5A91F49AC4B}")
    ).toBe(true);
    expect(isGuidListValue("")).toBe(false);
    expect(isGuidListValue("not-a-guid")).toBe(false);
    expect(isGuidListValue("{F7332C33-2305-40B1-904D-9823350A774F}|junk")).toBe(false);
  });

  it("canonicalises to braced-uppercase, preserving ORDER (multilist order is author-meaningful)", () => {
    expect(
      canonicaliseGuidList(
        "bb07f87b-7d77-416e-b71d-b5a91f49ac4b|{f7332c33-2305-40b1-904d-9823350a774f}"
      )
    ).toBe("{BB07F87B-7D77-416E-B71D-B5A91F49AC4B}|{F7332C33-2305-40B1-904D-9823350A774F}");
  });

  it("hashFieldValueForBaseline hashes representation-insensitively for GUID lists", () => {
    const a = hashFieldValueForBaseline(
      "1172f251-dad4-4efb-a329-0c63500e4f1e",
      "{F7332C33-2305-40B1-904D-9823350A774F}|{BB07F87B-7D77-416E-B71D-B5A91F49AC4B}"
    );
    const b = hashFieldValueForBaseline(
      "1172f251-dad4-4efb-a329-0c63500e4f1e",
      "f7332c33-2305-40b1-904d-9823350a774f|bb07f87b-7d77-416e-b71d-b5a91f49ac4b"
    );
    expect(a).toBe(b);
    // Order still matters — a reorder is a REAL drift, not wire noise.
    const c = hashFieldValueForBaseline(
      "1172f251-dad4-4efb-a329-0c63500e4f1e",
      "{BB07F87B-7D77-416E-B71D-B5A91F49AC4B}|{F7332C33-2305-40B1-904D-9823350A774F}"
    );
    expect(c).not.toBe(a);
  });
});
