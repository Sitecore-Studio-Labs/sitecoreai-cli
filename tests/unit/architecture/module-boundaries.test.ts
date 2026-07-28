/**
 * Architecture guardrail: the two module boundaries hardened for the
 * 0.1.0 release must not regress.
 *
 *   1. `src/shared/` is a LEAF. It may import other `@/shared` modules
 *      and the type-only `@/config` declarations, and nothing else. A
 *      `shared/` file reaching into a domain area (`@/policy`,
 *      `@/recipe`, …) is what created the original `shared ↔ policy`
 *      cycle — `allow-write.ts` and `env.ts` imported `@/policy`.
 *
 *   2. `src/content/` does NOT import `@/publishing`. `content` is the
 *      lower layer; `publishing` may depend on `content` (e.g.
 *      `publishing/tasks/unpublish.ts` → `@/content/api/version-fields`),
 *      but not the reverse. The reverse edge created the original
 *      `content ↔ publishing` cycle.
 *
 * This test is intentionally TARGETED, not a full cycle detector.
 * Peer domain areas legitimately cross-import (e.g. `sync` aggregates
 * `brand`/`brief`); policing the whole mesh is out of scope. The hard,
 * non-negotiable invariant is that `shared/` stays a leaf.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../../src");

/** Top-level `src/` domain areas — anything `shared/` must not import. */
const DOMAIN_AREAS = [
  "agents",
  "auth",
  "authoring",
  "brand",
  "brief",
  "campaigns",
  "commands",
  "content",
  "deploy",
  "doctor",
  "hygiene",
  "mcp",
  "policy",
  "publishing",
  "recipe",
  "scripting",
  "serialization",
  "sites",
  "sync",
  "telemetry",
  "webhooks",
  "workflow",
];

const tsFilesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? tsFilesUnder(full) : full.endsWith(".ts") ? [full] : [];
  });

/** Every `@/<area>` specifier imported by `file`. */
const aliasImportsOf = (file: string): string[] => {
  const text = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  const re = /from\s+"@\/([a-z-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
};

describe("module boundaries", () => {
  it("src/shared/ is a leaf — imports only @/shared and @/config", () => {
    const offenders: string[] = [];
    for (const file of tsFilesUnder(path.join(SRC, "shared"))) {
      for (const area of aliasImportsOf(file)) {
        if (area !== "shared" && area !== "config") {
          offenders.push(`${path.relative(SRC, file)} imports @/${area}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("src/content/ does not import @/publishing (one-way: publishing → content)", () => {
    const offenders: string[] = [];
    for (const file of tsFilesUnder(path.join(SRC, "content"))) {
      if (aliasImportsOf(file).includes("publishing")) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(offenders, `content/ must not import publishing/:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("src/sync/index.ts does not re-export aggregate-kinds (guards the sync↔domains cycle)", () => {
    // `sync/aggregate-kinds.ts` imports @/brand/recipe + @/brief/recipe +
    // @/recipe/sandbox, while 20+ files in those areas import @/sync. The
    // runtime cycle is avoided ONLY because the sync barrel deliberately does
    // not surface aggregate-kinds — its two consumers (commands/sync.ts,
    // mcp/tools/recipe-sync.ts) deep-import it. A careless barrel re-export
    // would create a real cycle instantly; this pins the omission.
    const barrel = readFileSync(path.join(SRC, "sync/index.ts"), "utf8");
    expect(
      /aggregate-kinds/.test(barrel),
      "sync/index.ts must not reference ./aggregate-kinds — deep-import it from " +
        "commands/ or mcp/ instead, or the sync↔brand/brief/recipe cycle returns."
    ).toBe(false);
  });

  it("DOMAIN_AREAS stays in sync with src/", () => {
    const actual = readdirSync(SRC)
      .filter((entry) => statSync(path.join(SRC, entry)).isDirectory())
      .sort();
    // `shared` and `config` are the leaf layers; everything else is a domain area.
    const expected = actual.filter((a) => a !== "shared" && a !== "config");
    expect(DOMAIN_AREAS).toEqual(expected);
  });
});
