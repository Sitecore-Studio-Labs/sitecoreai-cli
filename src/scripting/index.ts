/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/scripting`.
 *
 * Ergonomic surface for ad-hoc TypeScript scripts against a scai-
 * configured Sitecore environment. Distinct from `scai/hygiene`,
 * `scai/deploy`, etc., which expose raw API clients — `scai/scripting`
 * wires auth + config in one call and adds composable helpers shaped
 * for the kinds of one-off investigations and surgical edits that
 * don't fit any CLI command (reverse-dependency scans, multilist GUID
 * surgery, composite cleanup flows).
 *
 * Stability contract: every symbol below is intentional. Internal
 * helpers stay in sibling files and are not re-exported.
 *
 * See `docs/scripting.md` for examples.
 */

export { connect, type ScaiClient, type ConnectOptions } from "./connect";

export * as multilist from "./helpers/multilist";
