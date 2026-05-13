# Parked changesets

Changeset entries staged here are intentionally **outside** `.changeset/`
so the Changesets CLI never reads them. Use this directory to hold
release notes for surface area that isn't ready to ship yet — e.g. a
feature that's compiled but un-advertised, or work that's been deferred
to a later release.

Why a sibling directory and not a `.changeset/parked/` subdir? Changesets
traverses subdirectories of `.changeset/` looking for grouped changeset
entries (it expects a `changes.md` per subdir), so any nesting confuses
the tool.

When the work is ready to ship, `git mv` the file into `.changeset/`
before running `pnpm changeset version`.
