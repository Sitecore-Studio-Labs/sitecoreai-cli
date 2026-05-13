/**
 * Public barrel for `@sitecoreai-labs/sitecoreai-cli/errors`.
 *
 * Library consumers (orchestrators, MCP servers, other tools) import
 * the error envelope from here. The internal `@/shared/errors` module
 * stays the implementation and may grow internal helpers that aren't
 * part of the public surface — anything that should be public must be
 * re-exported here.
 *
 * Backward-compatible `CliError*` aliases are also re-exported so any
 * pre-rename consumers keep working through one major version, after
 * which they'll be removed.
 */

export {
  ScaiError,
  type ScaiErrorCode,
  createScaiError,
  toScaiError,
  withHint,
  // Deprecated — kept for one major version.
  CliError,
  type CliErrorCode,
  createCliError,
  toCliError,
} from "./errors";
