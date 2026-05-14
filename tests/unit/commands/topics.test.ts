/**
 * `scai topics` curated index — tests pin the shape (slug uniqueness,
 * non-empty descriptions, ≥1 command per topic) so a future edit
 * can't accidentally publish a half-defined entry.
 */
import { describe, expect, it } from "vitest";
import { __topicsForTest } from "../../../src/commands/topics";

describe("topics", () => {
  it("has at least one topic defined", () => {
    expect(__topicsForTest.length).toBeGreaterThan(0);
  });

  it("uses unique kebab-case slugs", () => {
    const slugs = __topicsForTest.map((t) => t.name);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("requires every topic to carry a description and ≥1 command", () => {
    for (const t of __topicsForTest) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.commands.length).toBeGreaterThan(0);
      for (const c of t.commands) {
        expect(c.command).toMatch(/^scai /);
        expect(c.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("includes the diagnose-blocked-delete topic referencing explain why-blocked", () => {
    const topic = __topicsForTest.find((t) => t.name === "diagnose-blocked-delete");
    expect(topic).toBeDefined();
    expect(topic?.commands.some((c) => c.command.includes("explain why-blocked"))).toBe(true);
  });

  it("includes the manage-known-debt topic referencing baseline accept", () => {
    const topic = __topicsForTest.find((t) => t.name === "manage-known-debt");
    expect(topic).toBeDefined();
    expect(topic?.commands.some((c) => c.command.includes("baseline accept"))).toBe(true);
  });

  it("includes the pipeline-audit-cleanup topic referencing --from-stdin", () => {
    const topic = __topicsForTest.find((t) => t.name === "pipeline-audit-cleanup");
    expect(topic).toBeDefined();
    expect(topic?.commands.some((c) => c.command.includes("--from-stdin"))).toBe(true);
  });
});
