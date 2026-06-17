/**
 * Deploy domain — workflow-shaped tools over scai's Deploy API surface.
 *
 * The library exports ~40 fetch/mutate primitives in `@/deploy/api`.
 * Here, those primitives are recomposed into 12 task-shaped tools that
 * match how an agent actually reasons about an XM Cloud tenant:
 *
 *   - `*_inspect` tools fan out to read multiple resources in one call
 *     and return a coherent "snapshot" structure.
 *   - `*_manage` / `*_lifecycle` tools take a discriminated `action`
 *     input and route to the right write primitive. The dispatcher's
 *     allowWrite gate runs before any side-effecting library call.
 *
 * Never expose secret-returning library calls (edge token, editing
 * secret, source-control access tokens). Auth flows are server-side
 * only; agents reason about the bound env via deploy_environment_inspect.
 *
 * The registrations are split by sub-domain into sibling files under
 * `./deploy/` (organization / project / environment / deployment /
 * source-control), each exporting a `register*Tools` function. This file
 * is the thin aggregator that wires them in registration order; shared
 * pagination / options helpers live in `./deploy/shared`.
 */

import type { McpRegistry } from "../registry";
import { registerDeployOrganizationTools } from "./deploy/organization";
import { registerDeployProjectTools } from "./deploy/project";
import { registerDeployEnvironmentTools } from "./deploy/environment";
import { registerDeployRunTools } from "./deploy/deployment";
import { registerDeploySourceControlTools } from "./deploy/source-control";

export const registerDeployTools = (registry: McpRegistry): void => {
  registerDeployOrganizationTools(registry);
  registerDeployProjectTools(registry);
  registerDeployEnvironmentTools(registry);
  registerDeployRunTools(registry);
  registerDeploySourceControlTools(registry);
};
