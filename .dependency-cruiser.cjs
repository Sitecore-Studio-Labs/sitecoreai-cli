/** @type {import("dependency-cruiser").IConfiguration} */
// Machine-enforced module boundaries for src/. These mirror the prose rules
// in CLAUDE.md ("Layers and module boundaries") and supersede the targeted
// regex test in tests/unit/architecture/module-boundaries.test.ts as the
// broad net — adding the two rules that test never covered (domains ↛
// commands, config ↛ domains) plus full cycle detection. The test is kept
// as a fast, dependency-free supplement that also pins the DOMAIN_AREAS list.
//
// Layers (from CLAUDE.md):
//   commands/  may import any domain area, config/, shared/
//   <domain>/  may import peer domains, config/, shared/ — never commands/
//   config/    may import shared/ (and serialization schemas it validates)
//   shared/    LEAF — only @/shared and (type-only) @/config
//   content/   must not import publishing/ (one-way: publishing → content)
//
// NOTE: CLAUDE.md says "config/ may import shared/ only", but config/modules.ts
// imports ItemPath + schema types from serialization/ at runtime (serialization
// defines the schemas config validates against). That edge is intentional in
// the code, so it is NOT forbidden here — the prose is the thing that's out of
// date. Flag for a doc fix rather than a code change.
module.exports = {
  forbidden: [
    {
      // shared/ is a hard leaf. The original shared↔policy cycle was born
      // from shared/ reaching into a domain area (allow-write.ts, env.ts).
      name: "shared-is-leaf",
      comment:
        "src/shared/ must import only other @/shared modules and @/config. " +
        "Reaching into a domain area or commands/ recreates the shared↔policy cycle.",
      severity: "error",
      from: { path: "^src/shared/" },
      to: { path: "^src/", pathNot: "^src/(shared|config)/" },
    },
    {
      // commands/ is the top layer; nothing below it may import upward.
      name: "no-imports-of-commands",
      comment:
        "Only the entrypoints (cli.ts, program.ts) and commands/ itself may " +
        "import commands/. A domain area, config/, or shared/ importing " +
        "@/commands inverts the layering.",
      severity: "error",
      from: {
        path: "^src/",
        // Exempt commands/ itself and the two entrypoints whose whole job is
        // to assemble the Commander tree out of the command modules.
        pathNot: "^src/commands/|^src/(cli|program)\\.ts$",
      },
      to: { path: "^src/commands/" },
    },
    {
      // content is the lower layer; publishing depends on content, not reverse.
      name: "content-not-import-publishing",
      comment:
        "src/content/ must not import @/publishing. publishing → content is " +
        "the allowed direction; the reverse edge was the old content↔publishing cycle.",
      severity: "error",
      from: { path: "^src/content/" },
      to: { path: "^src/publishing/" },
    },
    {
      // Catch any new cycle anywhere in the mesh. Peer domains may legitimately
      // cross-import, but a *circular* edge among them is a smell the targeted
      // test could never see. Type-only edges are erased at compile time and
      // don't form a real runtime cycle, so they're exempt.
      // Surfaced as a non-blocking WARN: ~40 pre-existing barrel cycles
      // (index.ts ↔ submodule re-exports) predate this gate, and the targeted
      // test was explicitly never a cycle detector. Warn keeps them visible as
      // a ratchet target without blocking CI on a refactor. Raise to "error"
      // once the existing cycles are cleared.
      name: "no-circular",
      comment:
        "No circular dependencies. Break the cycle by relocating the shared " +
        "module into shared/ (or a lower peer), as was done for shared↔policy " +
        "and content↔publishing.",
      severity: "warn",
      from: {},
      to: { circular: true, dependencyTypesNot: ["type-only"] },
    },
  ],
  options: {
    // Resolve @/* path aliases and follow type-only imports for cycle analysis.
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    includeOnly: "^src/",
  },
};
