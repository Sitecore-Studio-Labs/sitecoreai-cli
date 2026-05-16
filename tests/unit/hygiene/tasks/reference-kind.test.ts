/**
 * `classifyReferenceKind` maps a Sitecore field name to a structured
 * reference category so blocker reports tell the operator *why* a
 * delete is blocked, not just "field X mentions the target."
 */
import { describe, expect, it } from "vitest";
import {
  REFERENCE_KIND_PRIORITY,
  classifyReferenceKind,
} from "../../../../src/hygiene/tasks/reference-kind";

describe("classifyReferenceKind", () => {
  it("maps the five Sitecore structural fields to their canonical kinds", () => {
    expect(classifyReferenceKind("_template")).toBe("primary-template");
    expect(classifyReferenceKind("_basetemplates")).toBe("base-template");
    expect(classifyReferenceKind("__masters")).toBe("insert-options");
    expect(classifyReferenceKind("__source")).toBe("branch-source");
    expect(classifyReferenceKind("datasource template")).toBe("datasource-template");
  });

  it("falls back to field-value for anything else", () => {
    expect(classifyReferenceKind("Title")).toBe("field-value");
    expect(classifyReferenceKind("__Renderings")).toBe("field-value");
    expect(classifyReferenceKind("RelatedItems")).toBe("field-value");
    expect(classifyReferenceKind("Description")).toBe("field-value");
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(classifyReferenceKind("_BaseTemplates")).toBe("base-template");
    expect(classifyReferenceKind("__MASTERS")).toBe("insert-options");
    expect(classifyReferenceKind("  Datasource Template  ")).toBe("datasource-template");
    expect(classifyReferenceKind("_TEMPLATE")).toBe("primary-template");
  });

  it("orders structural kinds before plain field refs in REFERENCE_KIND_PRIORITY", () => {
    // base-template / insert-options / branch-source / datasource-template / primary-template
    // should all sort ahead of the catch-all field-value.
    const fieldValuePriority = REFERENCE_KIND_PRIORITY["field-value"];
    expect(REFERENCE_KIND_PRIORITY["base-template"]).toBeLessThan(fieldValuePriority);
    expect(REFERENCE_KIND_PRIORITY["insert-options"]).toBeLessThan(fieldValuePriority);
    expect(REFERENCE_KIND_PRIORITY["branch-source"]).toBeLessThan(fieldValuePriority);
    expect(REFERENCE_KIND_PRIORITY["datasource-template"]).toBeLessThan(fieldValuePriority);
    expect(REFERENCE_KIND_PRIORITY["primary-template"]).toBeLessThan(fieldValuePriority);
  });

  it("puts base-template ahead of every other kind (worst blocker first)", () => {
    const baseTemplate = REFERENCE_KIND_PRIORITY["base-template"];
    for (const kind of [
      "insert-options",
      "branch-source",
      "datasource-template",
      "primary-template",
      "field-value",
    ] as const) {
      expect(baseTemplate).toBeLessThan(REFERENCE_KIND_PRIORITY[kind]);
    }
  });
});
