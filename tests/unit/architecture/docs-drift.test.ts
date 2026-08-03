import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Catches drift between docs and code.
//
// Ported from demo-orchestrator's `tests/unit/docs-drift.test.ts`. The
// 2026-08-03 harness review found five bare-path drift findings across the
// three repos, and every one of them was in a repo without this check —
// including `src/shared/allow-write.ts`, which pointed at the exact location
// a refactor had emptied to keep `src/shared/` a leaf, one directory from the
// test that enforces it.
//
// Stale paths in a skill are worse than stale paths in prose: a skill is an
// instruction an agent acts on directly, so a wrong path produces confidently
// wrong work rather than a visible error.
//
// Two families of check:
//   1. PATH REFERENCES  — every backtick-quoted repo path in an enforced doc
//      must resolve to a real file or directory.
//   2. ALLOWLIST STALENESS — every escape hatch below has a test that fails
//      when its entries stop being true. Unguarded allowlists rot; these
//      cannot.

const ROOT = resolve(__dirname, "..", "..", "..");

const REPO_ROOTS = ["src", "tests", "scripts", "docs", "bin", "example"];
const PATH_RE = new RegExp(`\`((?:${REPO_ROOTS.join("|")})/[A-Za-z0-9_./*-]+)\``, "g");

// Docs that record a decision or observation *at a point in time*. Rewriting
// their paths would falsify the record, so they are excluded from
// enforcement rather than corrected.
const HISTORICAL_DIRS = ["docs/archive"];

// `skills/` is deliberately NOT scanned, and that is not an oversight.
//
// It ships inside the published npm package as guidance for agents *using*
// scai (see CLAUDE.md — distinct from `.claude/skills/`, which is for agents
// working *on* scai). Its `src/...` references describe the **consumer's**
// project layout, not this repo: `src/recipes/**/*.recipe.ts` is where a user
// puts their own recipe files. Enforcing those against this checkout would
// fail on a correct doc.
const CONSUMER_FACING_DIRS = ["skills"];

// Path segments that are deliberately fictional in prose.
const PLACEHOLDER_SEGMENTS = new Set([
  "group",
  "name",
  "file",
  "scenario",
  "command",
  "foo",
  "bar",
]);

// Paths a tool or a test author creates on first use; absent from a clean
// checkout by design.
//
// `tests/unit/_fixtures/` is the interesting one: `testing-conventions`
// writes it as "(create if not present)", so the skill is establishing a
// convention rather than claiming a directory exists. The 2026-08-03 review
// flagged it for an author's eye and it was dismissed for exactly this
// reason — it is not drift, and this entry is why the check agrees.
const RUNTIME_GENERATED = new Set<string>(["tests/unit/_fixtures/"]);

// Stale references not yet rewritten. Entries should be removed, never added
// — anything new is genuine drift to fix at source.
const KNOWN_STALE = new Set<string>([
  // docs/roadmap.md describes a staging probe for the unreleased Strategy
  // Brands API. The script was never committed; the paragraph is a record of
  // what was checked, not a pointer to runnable code.
  "scripts/_smoke-strategy-brand-probe.ts",
]);

const walkMarkdown = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdown(full));
    else if (entry.name.endsWith(".md")) files.push(full);
  }
  return files;
};

const isExcluded = (relPath: string): boolean =>
  [...HISTORICAL_DIRS, ...CONSUMER_FACING_DIRS].some(
    (dir) => relPath === dir || relPath.startsWith(`${dir}/`)
  );

/** Docs whose path claims must hold today. */
const collectEnforcedMarkdown = (): string[] => {
  const files = [
    ...walkMarkdown(join(ROOT, "docs")),
    // The harness skills — the highest-leverage place for a stale path,
    // because an agent acts on them without checking.
    ...walkMarkdown(join(ROOT, ".claude")),
    ...walkMarkdown(join(ROOT, "src")),
    ...["CLAUDE.md", "AGENTS.md", "README.md", "QUICKSTART.md"]
      .map((f) => join(ROOT, f))
      .filter((f) => existsSync(f) && statSync(f).isFile()),
  ];
  return files.filter((f) => !isExcluded(relative(ROOT, f))).sort();
};

/**
 * A reference resolves when the concrete part of it exists. Globs collapse to
 * their static prefix, so a doc may describe a shape without naming a file.
 */
const resolves = (relPath: string): boolean => {
  if (RUNTIME_GENERATED.has(relPath)) return true;
  // `tests/unit/...` and `src/<group>/tasks/<name>.ts` are prose templates.
  if (relPath.includes("...")) return true;
  if (relPath.split("/").some((seg) => PLACEHOLDER_SEGMENTS.has(seg))) {
    return true;
  }
  const starAt = relPath.indexOf("*");
  const concrete =
    starAt === -1 ? relPath.replace(/\/$/, "") : relPath.slice(0, relPath.lastIndexOf("/", starAt));
  return concrete.length > 0 && existsSync(join(ROOT, concrete));
};

const collectReferences = (files: string[]) => {
  const refs: { doc: string; path: string }[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(PATH_RE)) {
      const path = match[1];
      if (path) refs.push({ doc: relative(ROOT, file), path });
    }
  }
  return refs;
};

describe("docs: code references resolve to real files", () => {
  const files = collectEnforcedMarkdown();
  const refs = collectReferences(files);

  it("scans the harness skills and the docs tree, not just the root files", () => {
    // Guards the scope itself: the whole point of this port is breadth, and a
    // regression to a couple of root files would silently restore the gap it
    // exists to close.
    expect(files.length).toBeGreaterThan(20);
    const dirs = new Set(files.map((f) => relative(ROOT, f).split("/")[0]));
    expect([...dirs].sort()).toEqual(expect.arrayContaining([".claude", "CLAUDE.md", "docs"]));
  });

  it("every `src/…`, `tests/…`, `scripts/…` reference exists", () => {
    const missing = refs
      .filter((r) => !KNOWN_STALE.has(r.path) && !resolves(r.path))
      .map((r) => `${r.doc} → \`${r.path}\``);
    expect(
      [...new Set(missing)].sort(),
      "either fix the doc or, for legacy entries, add to KNOWN_STALE with a reason"
    ).toEqual([]);
  });

  it("KNOWN_STALE entries still appear in the docs", () => {
    const allText = files.map((f) => readFileSync(f, "utf8")).join("\n");
    const orphaned = [...KNOWN_STALE].filter((path) => !allText.includes(`\`${path}\``));
    expect(orphaned, "remove entries from KNOWN_STALE once the doc has been updated").toEqual([]);
  });

  it("KNOWN_STALE entries are actually still missing", () => {
    const present = [...KNOWN_STALE].filter((p) => existsSync(join(ROOT, p)));
    expect(present, "this path exists now — drop it from KNOWN_STALE so the check owns it").toEqual(
      []
    );
  });

  it("HISTORICAL_DIRS and CONSUMER_FACING_DIRS all exist", () => {
    const gone = [...HISTORICAL_DIRS, ...CONSUMER_FACING_DIRS].filter(
      (d) => !existsSync(join(ROOT, d))
    );
    expect(gone, "drop directories that no longer exist").toEqual([]);
  });

  it("RUNTIME_GENERATED paths are still referenced and still absent", () => {
    const allText = files.map((f) => readFileSync(f, "utf8")).join("\n");
    const orphaned = [...RUNTIME_GENERATED].filter((p) => !allText.includes(`\`${p}\``));
    expect(orphaned, "no doc mentions these — drop the entries").toEqual([]);
    // Once one is committed it is no longer "created on first use" and the
    // ordinary existence check should own it.
    const committed = [...RUNTIME_GENERATED].filter((p) => existsSync(join(ROOT, p)));
    expect(committed, "now committed — remove from RUNTIME_GENERATED").toEqual([]);
  });

  it("PLACEHOLDER_SEGMENTS name no real domain area", () => {
    const real = [...PLACEHOLDER_SEGMENTS].filter((seg) => existsSync(join(ROOT, "src", seg)));
    expect(real, "a placeholder became a real area — rename the placeholder in the docs").toEqual(
      []
    );
  });

  it("catches a broken path (guards the guard)", () => {
    // Mutation proof. Without this, a regex that matched nothing would leave
    // every other test in this file passing vacuously — which is precisely
    // how the orchestrator's HTTP-surface snapshot sat empty for its whole
    // life before someone pinned a floor.
    const sample = "src/this-module-does-not-exist/nope.ts";
    expect(resolves(sample)).toBe(false);
    expect([...`\`${sample}\``.matchAll(PATH_RE)].map((m) => m[1])).toEqual([sample]);
    // And the real tree is non-trivially covered, so the suite above is not
    // asserting over an empty set.
    expect(refs.length).toBeGreaterThan(20);
  });
});
