import { describe, expect, it } from "vitest";
import {
  buildStandardValuesFieldEntries,
  emitStandardValuesLocaleVersions,
} from "../../../src/recipe/compile/shared";
import type { AddItemVersionOp, Operation, SetFieldOp } from "../../../src/recipe/ir/operations";
import type { FieldDefinition } from "../../../src/recipe/schema/recipe";

/**
 * Unit tests for locale-map `__Standard Values` defaults — the primary /
 * non-primary split `buildStandardValuesFieldEntries` produces, the
 * Sites-API language filter, the shape/primary validation, and the
 * AddItemVersion + SetField ops `emitStandardValuesLocaleVersions` emits.
 */

const SITE = "acme";
const HANDLE = "cta-button@1";

const textField = (name: string, def: FieldDefinition["default"]): FieldDefinition => ({
  name,
  shape: "text",
  default: def,
});

describe("buildStandardValuesFieldEntries — plain-string default (unchanged)", () => {
  it("emits a single primary-language entry and no locale versions", () => {
    const build = buildStandardValuesFieldEntries(SITE, HANDLE, [
      textField("Label", "Get in touch"),
    ]);
    expect(build.localeVersions).toEqual([]);
    expect(build.primary).toHaveLength(1);
    expect(build.primary[0]).toMatchObject({
      fieldName: "Label",
      language: "en",
      version: 1,
      value: { kind: "string", value: "Get in touch" },
    });
  });
});

describe("buildStandardValuesFieldEntries — locale-map default", () => {
  it("splits the primary (en) version from the non-primary language versions", () => {
    const build = buildStandardValuesFieldEntries(SITE, HANDLE, [
      textField("Label", { en: "Get in touch", de: "Kontakt aufnehmen", fr: "Contactez-nous" }),
    ]);

    // Primary version rides on the CreateItem.
    expect(build.primary).toHaveLength(1);
    expect(build.primary[0]).toMatchObject({
      fieldName: "Label",
      language: "en",
      value: { kind: "string", value: "Get in touch" },
    });

    // Non-primary versions, sorted by locale (de before fr).
    expect(build.localeVersions.map((v) => v.language)).toEqual(["de", "fr"]);
    expect(build.localeVersions[0]).toMatchObject({
      fieldName: "Label",
      language: "de",
      value: { kind: "string", value: "Kontakt aufnehmen" },
    });
    // Same field id across every language version.
    expect(new Set(build.localeVersions.map((v) => v.fieldId))).toEqual(
      new Set([build.primary[0].fieldId])
    );
  });

  it("resolves exact regional keys to the registered code, dropping unregistered ones", () => {
    const build = buildStandardValuesFieldEntries(
      SITE,
      HANDLE,
      [
        textField("Label", {
          en: "Get in touch",
          "de-DE": "Kontakt aufnehmen",
          "fr-FR": "Contactez-nous",
        }),
      ],
      undefined,
      undefined,
      ["en-US", "de-DE"] // fr-FR absent → dropped
    );
    expect(build.primary).toHaveLength(1); // primary always emitted
    expect(build.localeVersions.map((v) => v.language)).toEqual(["de-DE"]);
  });

  it("fans a base-language key out to every registered regional variant", () => {
    const build = buildStandardValuesFieldEntries(
      SITE,
      HANDLE,
      // Author one `de` translation; environment has three German regions.
      [textField("Label", { en: "Get in touch", de: "Kontakt aufnehmen" })],
      undefined,
      undefined,
      ["en-US", "de-DE", "de-AT", "de-CH", "fr-FR"]
    );
    // `de` fans to all de-*; fr-FR has no authored key → not emitted.
    expect(build.localeVersions.map((v) => v.language)).toEqual(["de-AT", "de-CH", "de-DE"]);
    for (const v of build.localeVersions) {
      expect(v.value).toEqual({ kind: "string", value: "Kontakt aufnehmen" });
    }
  });

  it("lets an explicit regional key override the base-language expansion", () => {
    const build = buildStandardValuesFieldEntries(
      SITE,
      HANDLE,
      [textField("Label", { en: "Get in touch", de: "Kontakt aufnehmen", "de-CH": "Grüezi" })],
      undefined,
      undefined,
      ["en-US", "de-DE", "de-CH"]
    );
    const byLang = Object.fromEntries(
      build.localeVersions.map((v) => [
        v.language,
        v.value.kind === "string" ? v.value.value : undefined,
      ])
    );
    expect(byLang).toEqual({ "de-DE": "Kontakt aufnehmen", "de-CH": "Grüezi" });
  });

  it("handles the zh Simplified/Traditional split via explicit regional keys", () => {
    const build = buildStandardValuesFieldEntries(
      SITE,
      HANDLE,
      [textField("Label", { en: "Search", "zh-CN": "搜索", "zh-TW": "搜尋" })],
      undefined,
      undefined,
      ["en-US", "zh-CN", "zh-TW"]
    );
    const byLang = Object.fromEntries(
      build.localeVersions.map((v) => [
        v.language,
        v.value.kind === "string" ? v.value.value : undefined,
      ])
    );
    expect(byLang).toEqual({ "zh-CN": "搜索", "zh-TW": "搜尋" });
  });

  it("rejects a locale map missing the primary language", () => {
    expect(() =>
      buildStandardValuesFieldEntries(SITE, HANDLE, [
        textField("Label", { de: "Kontakt aufnehmen" }),
      ])
    ).toThrow(/primary language 'en'/);
  });

  it("rejects a locale map on a non-text shape", () => {
    const enumField: FieldDefinition = {
      name: "Scheme",
      shape: "enum",
      default: { en: "primary", de: "primary" } as unknown as FieldDefinition["default"],
      sitecore: { enumHandle: "color-scheme@1" },
    };
    expect(() => buildStandardValuesFieldEntries(SITE, HANDLE, [enumField])).toThrow(
      /only supported on text \/ rich-text/
    );
  });
});

describe("emitStandardValuesLocaleVersions", () => {
  it("emits one AddItemVersion per language followed by each SetField", () => {
    const build = buildStandardValuesFieldEntries(SITE, HANDLE, [
      textField("Label", { en: "Get in touch", de: "Kontakt aufnehmen" }),
      textField("Subtitle", { en: "We'd love to hear from you", de: "Wir freuen uns" }),
    ]);

    const ops: Operation[] = [];
    emitStandardValuesLocaleVersions(ops, "sv-refkey", build.localeVersions, "must", "sv:test");

    // Two fields, both with a `de` version → one AddItemVersion (de) then
    // two SetField ops.
    const addVersions = ops.filter((o): o is AddItemVersionOp => o.op === "AddItemVersion");
    const setFields = ops.filter((o): o is SetFieldOp => o.op === "SetField");
    expect(addVersions).toHaveLength(1);
    expect(addVersions[0]).toMatchObject({ itemRefKey: "sv-refkey", language: "de", version: 1 });
    expect(setFields).toHaveLength(2);
    expect(setFields.every((o) => o.language === "de" && o.itemRefKey === "sv-refkey")).toBe(true);

    // AddItemVersion for a language precedes its SetFields.
    expect(ops[0].op).toBe("AddItemVersion");
  });

  it("emits nothing for an empty locale-version list", () => {
    const ops: Operation[] = [];
    emitStandardValuesLocaleVersions(ops, "sv-refkey", [], "must", "sv:test");
    expect(ops).toEqual([]);
  });
});
