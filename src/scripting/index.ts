/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/unstable/scripting`.
 *
 * Ergonomic surface for ad-hoc TypeScript scripts against a scai-
 * configured Sitecore environment. Distinct from `scai/hygiene`,
 * `scai/deploy`, etc., which expose raw API clients — `scai/scripting`
 * wires auth + config in one call and adds composable helpers shaped
 * for the kinds of one-off investigations and surgical edits that
 * don't fit any CLI command (reverse-dependency scans, multilist GUID
 * surgery, composite cleanup flows).
 *
 * UNSTABLE entry: this ships under `./unstable/scripting` and carries
 * no SemVer stability promise. `connect()` currently wires only the
 * `hygiene` area; its return shape will grow and the helper pattern is
 * still settling. It graduates to a stable entry in a later release.
 *
 * See `docs/scripting.md` for examples.
 */

export { connect, type ScaiClient, type ConnectOptions } from "./connect";

export * as multilist from "./helpers/multilist";
