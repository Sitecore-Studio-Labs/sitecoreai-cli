import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// While this package is pre-1.0, a `major` changeset is a bug.
//
// Changesets has no notion of the 0.x convention. Given `0.40.3` and a `major`
// changeset it produces **1.0.0**, not `0.41.0` — and it does so silently, in a
// bot-authored "Version Packages" PR that looks like every other release PR.
// That is exactly what happened: the ESM-only change was correctly *described*
// as breaking, marked `major`, and shipped 1.0.0 to npm before anyone read the
// version number.
//
// Pre-1.0, semver already says breaking changes go in the MINOR position. So
// the rule here is simply: while `version` starts `0.`, no changeset may
// declare `major`. Write `minor` and say "Breaking:" in the summary.
//
// Delete this test when the project genuinely decides to cut 1.0 — that should
// be a deliberate act, not a side effect of picking a bump type.

const ROOT = resolve(__dirname, "..", "..", "..");
const CHANGESET_DIR = join(ROOT, ".changeset");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  name: string;
  version: string;
};

const isPreOneZero = () => pkg.version.startsWith("0.");

/** Every pending changeset file, excluding config and the README. */
const changesetFiles = (): string[] => {
  if (!existsSync(CHANGESET_DIR)) return [];
  return readdirSync(CHANGESET_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort();
};

/**
 * The bump type a changeset declares for this package, read from its
 * frontmatter: `"@scope/name": major`.
 */
const declaredBump = (file: string): string | undefined => {
  const text = readFileSync(join(CHANGESET_DIR, file), "utf8");
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
  if (!frontmatter) return undefined;
  const escaped = pkg.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return frontmatter.match(new RegExp(`["']?${escaped}["']?\\s*:\\s*(\\w+)`))?.[1];
};

describe("changeset bump types are valid for the current major", () => {
  it("no pending changeset declares `major` while pre-1.0", () => {
    if (!isPreOneZero()) return; // past 1.0 — `major` is legitimate again.
    const offenders = changesetFiles()
      .map((f) => [f, declaredBump(f)] as const)
      .filter(([, bump]) => bump === "major")
      .map(([f]) => f);
    expect(
      offenders,
      `Changesets turns a \`major\` bump on ${pkg.version} into 1.0.0, not 0.x+1 — ` +
        "and does it in a bot PR nobody reads closely. Use `minor` and write " +
        '"Breaking:" in the summary instead.'
    ).toEqual([]);
  });

  it("every pending changeset declares a bump for this package", () => {
    // A changeset that names no package (typo in the scope, say) is consumed
    // silently and its summary never reaches the CHANGELOG.
    const orphaned = changesetFiles().filter((f) => declaredBump(f) === undefined);
    expect(orphaned, `each changeset must declare a bump for "${pkg.name}"`).toEqual([]);
  });

  it("declared bumps are real changeset keywords", () => {
    const valid = new Set(["major", "minor", "patch"]);
    const bogus = changesetFiles()
      .map((f) => [f, declaredBump(f)] as const)
      .filter(([, bump]) => bump !== undefined && !valid.has(bump))
      .map(([f, bump]) => `${f}: ${bump}`);
    expect(bogus).toEqual([]);
  });

  it("the guard is reading real frontmatter, not passing vacuously", () => {
    // If the frontmatter regex ever stops matching, every check above passes
    // over an empty set. Prove the parser works on a known-good shape.
    const sample = `---\n"${pkg.name}": minor\n---\n\nSummary.\n`;
    const frontmatter = sample.match(/^---\n([\s\S]*?)\n---/)?.[1];
    expect(frontmatter).toBeDefined();
    const escaped = pkg.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(frontmatter?.match(new RegExp(`["']?${escaped}["']?\\s*:\\s*(\\w+)`))?.[1]).toBe(
      "minor"
    );
  });
});
