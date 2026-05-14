/**
 * Publishing job shapes — surfaced through the Authoring GraphQL
 * `publish()` mutation and `publishingStatus(id)` query (see
 * [src/serialization/sitecore-api/publish.ts]).
 *
 * scai uses the GraphQL surface rather than the SAI Publishing REST
 * API because:
 *   - it auth's with the existing `xmcloud.cm:admin` scope (no
 *     extra Auth0 client-grant needed)
 *   - it's the same surface the legacy dotnet `Sitecore.DevEx` CLI
 *     uses
 *
 * See `docs/parity-with-devex.md` § "Why not the SAI Publishing
 * REST API" for the full decision record.
 */

/**
 * Lifecycle states the Authoring GraphQL `publishingStatus(id)` query
 * returns via `stateName` (and a numeric `stateCode`). Strings vary
 * across deployments — normalize to this union when reading.
 */
export type PublishJobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface PublishJob {
  id: string;
  state: PublishJobState;
  /** Raw state code from GraphQL (kept for diagnostics). */
  stateCode?: number;
  /** Items processed so far. Populated as the job progresses. */
  processedCount?: number;
}
