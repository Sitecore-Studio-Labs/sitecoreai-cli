/**
 * `setup/` — environment-setup orchestration domain.
 *
 * The environment lifecycle layer: init/onboard an environment profile,
 * mint and store credentials, provision org/CM clients, and bootstrap a
 * fresh tenant. It composes the `deploy`, `recipe`, and `brand` product
 * surfaces (allowed peer-area edges) — which is precisely why it lives in
 * its own area rather than inside `serialization/`, whose product surface
 * must not depend on those.
 *
 * SDK barrel: re-exports the public task entry points that `commands/`,
 * `cli.ts`, and `mcp/` drive.
 */

export { runInit, resolveSiteIdentity, matchSiteCollection } from "./init";
export { runEnvironmentOnboard } from "./onboard";
export { runDeployToken } from "./deploy-token";
export { runStatus } from "./status";
export { runLogout } from "./logout";
export { runBootstrap, isHeadAppRepo } from "./bootstrap";
export { runSetupEnv } from "./setup-env";
export { runSetupOrgClient } from "./setup-org-client";
export { runSetupClients } from "./setup-clients";
