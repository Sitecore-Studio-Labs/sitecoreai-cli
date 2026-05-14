export const DEFAULT_PUBLIC_CLIENT_ID = "Chi8EwfFnEejksk3Sed9hlalGiM9B2v7";

/**
 * Auth0 only includes scopes in a token if the request asks for them
 * (or the client has them as a "default" grant). When `scope` is omitted
 * on a device-code or client_credentials request, the issuer hands back
 * the client's default grant only — which for the public scai CLI
 * client is the `xmclouddeploy.*` family. That leaves Authoring API
 * calls (any `xmcloud.cm:admin`-gated path: recipes, workflow, webhook)
 * with no usable token even after a "successful" login.
 *
 * Below: the full scope set scai requests at login. Mirrors what an
 * operator could plausibly need across the CLI's surface — Deploy
 * lifecycle, Authoring API writes (`xmcloud.cm:admin`), platform
 * inventory, IAM read. Tokens are issued for the intersection of this
 * list and the client's allow-list in Auth0, so misconfigured clients
 * still mint *something* — just without the missing scope, which then
 * surfaces as a clean upstream 401 rather than a silently-empty scope.
 */

const SCAI_API_SCOPES = [
  // Authoring + Management GraphQL — the missing-link scope that lets
  // recipes, workflow, and webhook tools call api.sitecorecloud.io's
  // Authoring API.
  "xmcloud.cm:admin",
  // Deploy API — projects, environments, deployments, repos, monitoring.
  "xmclouddeploy.clients:manage",
  "xmclouddeploy.deployments:manage",
  "xmclouddeploy.environments:manage",
  "xmclouddeploy.monitoring.deployments:read",
  "xmclouddeploy.organizations:manage",
  "xmclouddeploy.projects:manage",
  "xmclouddeploy.rh:mng",
  "xmclouddeploy.site:mng",
  "xmclouddeploy.sourcecontrol:manage",
  // Platform inventory + IAM read — needed by scai status / org
  // inspectors when an agent walks the tenancy tree.
  "platform.tenants:listall",
  "iam.usr_roles:r",
  // SAI Publishing API — tenant-tier scopes used by `scai publish`.
  // Granted only on environment-level automation clients per the
  // Publishing API architect (org-level clients won't get them, and
  // the issued token will just omit them in that case — harmless).
  "xmcpub.jobs.t:r",
  "xmcpub.jobs.t:w",
  "xmcpub.queue:r",
] as const;

/**
 * Scope set for the interactive device-code flow. Adds the OIDC user-
 * context scopes plus `offline_access` so we get a refresh token back.
 * Joining with spaces is the OAuth/OIDC standard separator for the
 * `scope` parameter.
 */
export const SCAI_DEVICE_FLOW_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  ...SCAI_API_SCOPES,
].join(" ");

/**
 * Scope set for the client_credentials (m2m) flow. OIDC user-context
 * scopes (openid/profile/email) and `offline_access` don't apply to
 * machine clients; restrict to the API scopes only.
 */
export const SCAI_CLIENT_CREDENTIALS_SCOPES = SCAI_API_SCOPES.join(" ");
