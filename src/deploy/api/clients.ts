/**
 * XM Cloud Deploy **clients API** (`/api/clients/v1/*`) — mint and manage
 * OAuth automation credentials.
 *
 * Unlike the rest of the Deploy API (which operates on already-existing
 * resources), these endpoints **create credentials**: each mint call
 * returns a fresh `{ clientId, clientSecret }` pair. The `clientSecret`
 * is shown **once** in the response and is never retrievable again —
 * callers must persist it immediately.
 *
 * Two scopes of client:
 *   - **Environment-scoped** — `cm`, `edge`, `ehbuild`. The request
 *     carries `projectId` + `environmentId`; the credential is bound to
 *     that one environment.
 *   - **Organization-scoped** — `deploy`. The request carries only a
 *     name; the credential can deploy across the whole organization.
 *
 * Every endpoint runs under the Deploy API's `ValidateOrganization` +
 * `xmclouddeploy.clients:manage` auth policies. Pass `organizationId`
 * so the request carries the org headers `ValidateOrganization` expects.
 */

import { withOrganizationHeaders } from "./common/headers";
import { deployRequest } from "./common/request";
import type { DeployApiClientOptions } from "./common/types";

/**
 * Request body for an environment-scoped client mint (`cm`, `edge`,
 * `ehbuild`). All three share this shape — the credential is bound to
 * the named project + environment.
 */
export interface CreateEnvironmentClientRequest {
  /** Display name for the client. Shows in the Cloud Portal clients list. */
  name: string;
  /** Optional human description. */
  description?: string;
  /** Project the credential is scoped to. */
  projectId: string;
  /** Environment the credential is scoped to. */
  environmentId: string;
}

/**
 * Request body for an organization-scoped deploy client mint. Deploy
 * clients are not bound to an environment — they carry only a name.
 */
export interface CreateDeployClientRequest {
  /** Display name for the client. */
  name: string;
  /** Optional human description. */
  description?: string;
}

/**
 * Response from any mint endpoint. The `clientSecret` is returned **once
 * only** — persist it before discarding this object.
 */
export interface MintedClient {
  name?: string;
  description?: string;
  clientId?: string;
  /** The one-time client secret. Never retrievable after this response. */
  clientSecret?: string;
}

/**
 * A client as returned by the environment-scoped list endpoint. Carries
 * no secret. `clientType` is the raw numeric `AuthenticationClientType`
 * enum (1–4); the spec does not name the values, so it is surfaced
 * unmapped.
 */
export interface DeployClientSummary {
  id?: string;
  name?: string;
  description?: string;
  clientId?: string;
  createdAt?: string;
  /** Raw AuthenticationClientType enum (1–4). Value→kind mapping not in the spec. */
  clientType?: number;
  projectName?: string;
  environmentName?: string;
}

/** A client as returned by the organization-scoped list endpoint. */
export interface OrganizationClientSummary {
  id?: string;
  name?: string;
  description?: string;
  clientId?: string;
  createdAt?: string;
  /** Raw AuthenticationClientType enum (1–4). Value→kind mapping not in the spec. */
  clientType?: number;
}

export interface ClientsListResponse {
  items?: DeployClientSummary[];
}

export interface OrganizationClientsListResponse {
  items?: OrganizationClientSummary[];
}

/**
 * Mint a **CM client** — an environment-scoped credential for the
 * Content Management / Authoring surface of one environment.
 */
export const mintCmClient = async (
  options: DeployApiClientOptions,
  request: CreateEnvironmentClientRequest,
  organizationId?: string
): Promise<MintedClient> =>
  deployRequest<MintedClient>(options, "/api/clients/v1/cm", undefined, {
    method: "POST",
    body: request,
    headers: withOrganizationHeaders(organizationId),
  });

/**
 * Mint a **deploy client** — an organization-scoped credential able to
 * run deployments across the whole org.
 */
export const mintDeployClient = async (
  options: DeployApiClientOptions,
  request: CreateDeployClientRequest,
  organizationId?: string
): Promise<MintedClient> =>
  deployRequest<MintedClient>(options, "/api/clients/v1/deploy", undefined, {
    method: "POST",
    body: request,
    headers: withOrganizationHeaders(organizationId),
  });

/**
 * Mint an **edge client** — an environment-scoped credential for the
 * Experience Edge delivery surface of one environment.
 */
export const mintEdgeClient = async (
  options: DeployApiClientOptions,
  request: CreateEnvironmentClientRequest,
  organizationId?: string
): Promise<MintedClient> =>
  deployRequest<MintedClient>(options, "/api/clients/v1/edge", undefined, {
    method: "POST",
    body: request,
    headers: withOrganizationHeaders(organizationId),
  });

/**
 * Mint an **editing-host build client** — an environment-scoped
 * credential used by editing-host build pipelines.
 */
export const mintEhBuildClient = async (
  options: DeployApiClientOptions,
  request: CreateEnvironmentClientRequest,
  organizationId?: string
): Promise<MintedClient> =>
  deployRequest<MintedClient>(options, "/api/clients/v1/ehbuild", undefined, {
    method: "POST",
    body: request,
    headers: withOrganizationHeaders(organizationId),
  });

/**
 * List the environment-scoped clients (`cm`, `edge`, `ehbuild`) in the
 * organization. Secrets are never included.
 */
export const listEnvironmentClients = async (
  options: DeployApiClientOptions,
  organizationId?: string
): Promise<ClientsListResponse> =>
  deployRequest<ClientsListResponse>(options, "/api/clients/v1/environment", undefined, {
    headers: withOrganizationHeaders(organizationId),
  });

/**
 * List the organization-scoped clients (`deploy`). Secrets are never
 * included.
 */
export const listOrganizationClients = async (
  options: DeployApiClientOptions,
  organizationId?: string
): Promise<OrganizationClientsListResponse> =>
  deployRequest<OrganizationClientsListResponse>(
    options,
    "/api/clients/v1/organization",
    undefined,
    { headers: withOrganizationHeaders(organizationId) }
  );

/**
 * Delete a client by id. Irreversible — the credential stops working
 * immediately. Server responds `202 Accepted`.
 */
export const deleteClient = async (
  options: DeployApiClientOptions,
  id: string,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/clients/v1/${encodeURIComponent(id)}`, undefined, {
    method: "DELETE",
    headers: withOrganizationHeaders(organizationId),
  });
