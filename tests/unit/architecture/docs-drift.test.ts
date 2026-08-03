import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Catches drift between docs and code.
//
// Three families of check:
//   1. PATH REFERENCES  — every backtick-quoted repo path, and every relative
//      markdown link, in an enforced doc must resolve to a real file or
//      directory.
//   2. STRUCTURAL CLAIMS — the domain-area block, the cross-cutting-layer
//      block, both skills indexes, and the quality-gates table are checked
//      against the code they describe, not against a string.
//   3. ALLOWLIST STALENESS — every escape hatch below (KNOWN_STALE,
//      HISTORICAL_DIRS, EXTERNAL_REPO_ROOTS) has a test that fails when its
//      entries stop being true. Unguarded allowlists rot; these cannot.
//
// Stale references are an agent-legibility hazard: if the docs say
// `src/shared/telemetry.ts` but the module lives at `src/telemetry/index.ts`,
// an agent reads the wrong file — or writes a new one in the wrong place.

const ROOT = resolve(__dirname, "..", "..", "..");

const REPO_ROOTS = ["src", "tests", "scripts", "docs", "skills"];
const PATH_RE = new RegExp(`\`((?:${REPO_ROOTS.join("|")})/[A-Za-z0-9_./*-]+)\``, "g");

// Markdown links: `](target)`. Skips absolute URLs, protocol-relative URLs,
// and bare anchors.
const LINK_RE = /\]\(([^)\s]+)\)/g;

// Directories that record a decision or audit *at a point in time*. Rewriting
// their paths would falsify the record, so they are excluded from enforcement.
// `docs/archive/` in particular holds cross-repo audits whose paths belong to
// the showcase repo, not this one.
const HISTORICAL_DIRS = ["docs/archive"];

// Repo roots that belong to a *different* checkout. `src/components/…` and
// `src/registry-content/…` are showcase paths; they may legitimately appear in
// prose here, but only inside a historical doc — hence this list exists purely
// so the staleness guard below can assert none of them ever became real here.
const EXTERNAL_REPO_ROOTS = ["src/components", "src/registry-content", "src/lib"];

// Stale references we have not yet rewritten. Entries should be removed (not
// added to) — anything new that shows up is genuine drift to fix at source.
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

const isHistorical = (relPath: string): boolean =>
  HISTORICAL_DIRS.some((dir) => relPath.startsWith(`${dir}/`));

/** Docs whose path claims must hold today. */
const collectEnforcedMarkdown = (): string[] => {
  const files = [
    ...walkMarkdown(join(ROOT, "docs")),
    // `.claude/skills/` is the harness system of record; `skills/` is the
    // consumer-facing bundle shipped in the tarball. Both are read by agents
    // and both were previously unscanned.
    ...walkMarkdown(join(ROOT, ".claude")),
    ...walkMarkdown(join(ROOT, "skills")),
    ...["CLAUDE.md", "AGENTS.md", "README.md", "CONTRIBUTING.md", "QUICKSTART.md", "SECURITY.md"]
      .map((f) => join(ROOT, f))
      .filter((f) => existsSync(f) && statSync(f).isFile()),
  ];
  return files.filter((f) => !isHistorical(relative(ROOT, f))).sort();
};

/**
 * A reference resolves when the concrete part of it exists. Globs collapse to
 * their static prefix — a glob under `src/recipe/` only needs `src/recipe/` to
 * exist — so a doc may describe a shape without naming a file.
 */
const resolves = (relPath: string): boolean => {
  // `src/...` and `tests/unit/...` are prose templates, not paths.
  if (relPath.includes("...")) return true;
  // `<area>` / `<group>` / `<name>` placeholders in the test-layout table.
  if (relPath.includes("<")) return true;
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
      refs.push({ doc: relative(ROOT, file), path: match[1] });
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
      if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(raw)) continue;
      const target = raw.split("#")[0];
      if (!target) continue;
      links.push({
        doc: relative(ROOT, file),
        target: raw,
        abs: resolve(dirname(file), target),
      });
    }
  }
  return links;
};

describe("docs: code references resolve to real files", () => {
  const files = collectEnforcedMarkdown();
  const refs = collectReferences(files);

  it("scans the whole enforced doc tree, not a single directory", () => {
    // Guards the widening itself: a regression to a non-recursive readdir over
    // `docs/` would drop this back to a handful of files.
    expect(files.length).toBeGreaterThan(40);
    const dirs = new Set(files.map((f) => relative(ROOT, f).split("/")[0]));
    expect([...dirs].sort()).toEqual(
      expect.arrayContaining([".claude", "CLAUDE.md", "docs", "skills"])
    );
  });

  it("every `src/…`, `tests/…`, `scripts/…`, `docs/…`, `skills/…` reference exists", () => {
    const missing = refs
      .filter((r) => !KNOWN_STALE.has(r.path) && !resolves(r.path))
      .map((r) => `${r.doc} → \`${r.path}\``);
    expect(
      [...new Set(missing)].sort(),
      "either fix the doc or, for legacy entries, add to KNOWN_STALE with a TODO"
    ).toEqual([]);
  });

  it("every relative markdown link resolves", () => {
    // Cross-repo links are the recurring failure here: a link into a sibling
    // checkout resolves on one machine and 404s everywhere else. Name the
    // other repo in prose instead of linking a path out of the tree.
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

  it("HISTORICAL_DIRS all exist", () => {
    const gone = HISTORICAL_DIRS.filter((d) => !existsSync(join(ROOT, d)));
    expect(gone, "drop directories that no longer exist").toEqual([]);
  });

  it("EXTERNAL_REPO_ROOTS name nothing in this repo", () => {
    // If one of these becomes a real directory here, the historical docs that
    // mention it stop being unresolvable-by-design and the ordinary existence
    // check should own those paths — drop the entry.
    const real = EXTERNAL_REPO_ROOTS.filter((p) => existsSync(join(ROOT, p)));
    expect(real, "this path is real now — remove it from EXTERNAL_REPO_ROOTS").toEqual([]);
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
    const missing = areas.filter((a) => !existsSync(join(ROOT, "src", a)));
    expect(missing, "the domain-area block names a directory that is gone").toEqual([]);
  });

  it("CLAUDE.md's stated domain-area count matches the block", () => {
    // The prose said "21 domain areas" while the block listed 22 — the exact
    // kind of silent arithmetic drift a reader trusts and never re-counts.
    const stated = readDoc("CLAUDE.md").match(/organized into (\d+) \*\*domain areas\*\*/)?.[1];
    expect(stated, "CLAUDE.md no longer states a domain-area count").toBeDefined();
    expect(Number(stated)).toBe(declaredDomainAreas().length);
  });

  it("codebase-conventions repeats the same domain-area count", () => {
    // The claim lives in two places. Both said 21 while `src/` had 22, and
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
    const missing = layers.filter((l) => !existsSync(join(ROOT, "src", l)));
    expect(missing).toEqual([]);
  });

  it("every directory under `src/` is documented as an area or a layer", () => {
    // The reverse direction: a new top-level area that nobody added to
    // CLAUDE.md is invisible to every agent that reads the map first.
    const documented = new Set([...declaredDomainAreas(), ...declaredCrossCutting()]);
    const undocumented = srcDirs().filter((d) => !documented.has(d));
    expect(
      undocumented,
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
    // `skills/` is published in the npm tarball — its index is the first thing
    // a consuming agent reads, and an unlisted skill is an unfindable one.
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
