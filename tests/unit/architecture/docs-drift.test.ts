import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
// Three families of check:
//   1. PATH REFERENCES  — every backtick-quoted repo path, and every relative
//      markdown link, in an enforced doc must resolve to a real file or
//      directory.
//   2. STRUCTURAL CLAIMS — the domain-area block, both skills indexes, and the
//      quality-gates table are checked against the code they describe, not
//      against a string. A count stated in prose is the drift nobody notices:
//      CLAUDE.md and `codebase-conventions` both said "21 domain areas" while
//      `src/` had 22, and neither cross-checked the other.
//   3. ALLOWLIST STALENESS — every escape hatch below has a test that fails
//      when its entries stop being true. Unguarded allowlists rot; these
//      cannot.

const ROOT = resolve(__dirname, "..", "..", "..");

const REPO_ROOTS = ["src", "tests", "scripts", "docs", "bin", "example"];
const PATH_RE = new RegExp(`\`((?:${REPO_ROOTS.join("|")})/[A-Za-z0-9_./*-]+)\``, "g");

// Markdown links: `](target)`. Skips absolute URLs, protocol-relative URLs,
// and bare anchors. A backticked path and a linked path drift the same way,
// but only the first was covered — and the two live links that were broken
// pointed into a *sibling checkout*, so they resolved on one machine and
// nowhere else.
const LINK_RE = /\]\(([^)\s]+)\)/g;

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
// (Empty. `tests/unit/_fixtures/` sat here on the grounds that
// `testing-conventions` wrote it as "(create if not present)" — establishing a
// convention rather than claiming a directory. That reading is fair, but the
// repo already has `tests/unit/recipe/_fixtures/`: the real convention is
// `_fixtures/` beside the area's tests, and a skill pointing somewhere else
// would seed a second, competing location. The skill now describes what the
// tree actually does, so the ordinary existence check owns it.)
const RUNTIME_GENERATED = new Set<string>([]);

// Stale references not yet rewritten. Entries should be removed, never added
// — anything new is genuine drift to fix at source.
// (Empty. `scripts/_smoke-strategy-brand-probe.ts` sat here as "never
// committed" — it was: `git log --diff-filter=D` puts its deletion in 3856095,
// the security scrub that removed recon artifacts. Allowlisting a pointer to a
// deliberately-deleted artifact preserves the pointer; docs/roadmap.md now
// describes the probe instead of naming a path that will never come back.)
const KNOWN_STALE = new Set<string>([]);

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

const collectLinks = (files: string[]) => {
  const links: { doc: string; target: string; abs: string }[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(LINK_RE)) {
      const raw = match[1];
      if (!raw || /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(raw)) continue;
      const target = raw.split("#")[0];
      if (!target) continue;
      links.push({ doc: relative(ROOT, file), target: raw, abs: resolve(dirname(file), target) });
    }
  }
  return links;
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

  it("every relative markdown link resolves", () => {
    // Cross-repo links are the recurring failure: a link into a sibling
    // checkout resolves for whoever wrote it and 404s for everyone else. Name
    // the other repo in prose instead of linking a path out of the tree.
    const broken = collectLinks(files)
      .filter((l) => !existsSync(l.abs))
      .map((l) => `${l.doc} → ${l.target}`);
    expect([...new Set(broken)].sort()).toEqual([]);
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

// ---------------------------------------------------------------------------
// Structural claims — assert against code, not against strings.
// ---------------------------------------------------------------------------

const readDoc = (relPath: string) => readFileSync(join(ROOT, relPath), "utf8");

/** Directory names directly under `src/`. */
const srcDirs = (): string[] =>
  readdirSync(join(ROOT, "src"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

/** The whitespace-separated area names in CLAUDE.md's domain-area block. */
const declaredDomainAreas = (): string[] => {
  const block = readDoc("CLAUDE.md").match(/```\n(deploy\s+serialization[\s\S]*?)```/);
  expect(block, "CLAUDE.md lost its domain-area block").not.toBeNull();
  return (block?.[1] ?? "").split(/\s+/).filter(Boolean).sort();
};

/** The `src/<name>/` entries in CLAUDE.md's cross-cutting-layer block. */
const declaredCrossCutting = (): string[] => {
  const block = readDoc("CLAUDE.md").match(/```\n(src\/cli\.ts[\s\S]*?)```/);
  expect(block, "CLAUDE.md lost its cross-cutting-layer block").not.toBeNull();
  return [...(block?.[1] ?? "").matchAll(/^src\/([a-z-]+)\/\s+←/gm)].map((m) => m[1]).sort();
};

const skillDirs = (root: string): string[] =>
  readdirSync(join(ROOT, root), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

describe("docs: structural claims match the code", () => {
  it("CLAUDE.md's domain-area block names directories that exist", () => {
    const areas = declaredDomainAreas();
    expect(areas.length).toBeGreaterThanOrEqual(20);
    expect(
      areas.filter((a) => !existsSync(join(ROOT, "src", a))),
      "the domain-area block names a directory that is gone"
    ).toEqual([]);
  });

  it("CLAUDE.md's stated domain-area count matches the block", () => {
    const stated = readDoc("CLAUDE.md").match(/organized into (\d+) \*\*domain areas\*\*/)?.[1];
    expect(stated, "CLAUDE.md no longer states a domain-area count").toBeDefined();
    expect(Number(stated)).toBe(declaredDomainAreas().length);
  });

  it("codebase-conventions repeats the same domain-area count", () => {
    // The claim lives in two files. Both said 21 while `src/` had 22, and
    // neither cross-checked the other — a duplicated fact with no guard is a
    // fact that drifts twice.
    const skill = readDoc(".claude/skills/codebase-conventions/SKILL.md");
    const stated = skill.match(/`src\/` is (\d+) \*\*domain areas\*\*/)?.[1];
    expect(stated, "codebase-conventions no longer states a domain-area count").toBeDefined();
    expect(Number(stated)).toBe(declaredDomainAreas().length);
  });

  it("CLAUDE.md's cross-cutting block names directories that exist", () => {
    const layers = declaredCrossCutting();
    expect(layers).toEqual(["commands", "config", "shared"]);
    expect(layers.filter((l) => !existsSync(join(ROOT, "src", l)))).toEqual([]);
  });

  it("every directory under `src/` is documented as an area or a layer", () => {
    // The reverse direction: a new top-level area nobody added to CLAUDE.md is
    // invisible to every agent that reads the map first.
    const documented = new Set([...declaredDomainAreas(), ...declaredCrossCutting()]);
    expect(
      srcDirs().filter((d) => !documented.has(d)),
      "add these to CLAUDE.md's domain-area block (and bump the stated count)"
    ).toEqual([]);
  });

  it("CLAUDE.md's skills table matches `.claude/skills/`", () => {
    const listed = new Set(
      [...readDoc("CLAUDE.md").matchAll(/^\| `([a-z][a-z0-9-]*)`\s+\|/gm)].map((m) => m[1])
    );
    const onDisk = new Set(skillDirs(".claude/skills"));
    expect(
      [...onDisk].filter((s) => !listed.has(s)).sort(),
      "skill exists but CLAUDE.md's table does not list it"
    ).toEqual([]);
    expect(
      [...listed].filter((s) => !onDisk.has(s)).sort(),
      "CLAUDE.md lists a skill with no `.claude/skills/<name>/` directory"
    ).toEqual([]);
    for (const skill of onDisk) {
      expect(existsSync(join(ROOT, ".claude/skills", skill, "SKILL.md"))).toBe(true);
    }
  });

  it("`skills/README.md` indexes every shipped skill", () => {
    // `skills/` is excluded from the path scan above (its `src/…` references
    // describe the consumer's project, not this repo) — but its *index* is a
    // claim about this repo's own tree, and it ships in the tarball as the
    // first thing a consuming agent reads. An unlisted skill is unfindable.
    const listed = new Set(
      [...readDoc("skills/README.md").matchAll(/^- `([a-z][a-z0-9-]*)`/gm)].map((m) => m[1])
    );
    const onDisk = new Set(skillDirs("skills"));
    expect(
      [...onDisk].filter((s) => !listed.has(s)).sort(),
      "shipped skill missing from skills/README.md"
    ).toEqual([]);
    expect(
      [...listed].filter((s) => !onDisk.has(s)).sort(),
      "skills/README.md lists a skill directory that does not exist"
    ).toEqual([]);
    for (const skill of onDisk) {
      expect(existsSync(join(ROOT, "skills", skill, "SKILL.md"))).toBe(true);
    }
  });

  it("CLAUDE.md's quality-gates table names real package scripts", () => {
    const scripts = (JSON.parse(readDoc("package.json")) as { scripts: Record<string, string> })
      .scripts;
    const claimed = [...readDoc("CLAUDE.md").matchAll(/^\| `pnpm ([a-z:]+)`\s+\|/gm)].map(
      (m) => m[1]
    );
    expect(claimed.length).toBeGreaterThanOrEqual(4);
    expect(
      claimed.filter((s) => !(s in scripts)),
      "the quality-gates table names a script package.json does not define"
    ).toEqual([]);
  });
});
