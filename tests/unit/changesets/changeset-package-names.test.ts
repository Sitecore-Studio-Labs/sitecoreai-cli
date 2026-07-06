import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// `changeset version` hard-errors on a changeset that names a package
// not in the workspace — but only when the RELEASE runs on main, long
// after the authoring PR merged (it broke the 0.18.0 and 0.19.0
// releases the same way: "sitecoreai-cli" instead of the scoped
// workspace name). Catch it at authoring time instead.

const ROOT = join(__dirname, "..", "..", "..");
const CHANGESET_DIR = join(ROOT, ".changeset");

const workspacePackageNames = new Set<string>([
  (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { name: string }).name,
]);

/** Package names from a changeset's YAML front matter (`"pkg": bump`). */
const frontMatterPackages = (source: string): string[] => {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  const packages: string[] = [];
  for (const line of match[1].split(/\r?\n/)) {
    const entry = line.match(/^\s*["']?([^"':]+)["']?\s*:/);
    if (entry) packages.push(entry[1].trim());
  }
  return packages;
};

describe("changeset front matter", () => {
  const files = readdirSync(CHANGESET_DIR).filter(
    (name) => name.endsWith(".md") && name !== "README.md"
  );

  it("every pending changeset names a real workspace package", () => {
    for (const file of files) {
      const source = readFileSync(join(CHANGESET_DIR, file), "utf8");
      const packages = frontMatterPackages(source);
      expect(packages.length, `${file}: no package entries in front matter`).toBeGreaterThan(0);
      for (const pkg of packages) {
        expect(
          workspacePackageNames.has(pkg),
          `${file}: "${pkg}" is not a workspace package — did you mean "@sitecoreai-labs/sitecoreai-cli"? changeset version will fail the release on main.`
        ).toBe(true);
      }
    }
  });
});
