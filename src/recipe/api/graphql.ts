/**
 * Authoring GraphQL transport for recipe execution.
 *
 * Thin wrapper over `src/shared/graphql.ts` — supplies the Authoring
 * service path and label. Parallels `src/serialization/sitecore-api/graphql.ts`
 * which targets the Management endpoint.
 *
 * XM Cloud Authoring API path. If a SitecoreAI tenant ever exposes the
 * endpoint at a different path, override via `SITECOREAI_AUTHORING_PATH`.
 */

import type { EnvironmentConfiguration } from "@/config";
import { runSitecoreGraphQL, type GraphQLRequestOptions } from "@/shared/graphql";
import { getAccessToken } from "./auth";

const DEFAULT_AUTHORING_PATH = "/sitecore/api/authoring/graphql/v1";

const resolveAuthoringPath = (): string =>
  process.env.SITECOREAI_AUTHORING_PATH ?? DEFAULT_AUTHORING_PATH;

export type AuthoringRequestOptions = GraphQLRequestOptions;

export const runAuthoringGraphQL = <T>(
  environment: EnvironmentConfiguration,
  query: string,
  variables?: Record<string, unknown>,
  options?: AuthoringRequestOptions
): Promise<T> =>
  runSitecoreGraphQL<T>(
    environment,
    query,
    variables,
    {
      servicePath: resolveAuthoringPath(),
      label: "Authoring",
      requireToken: true,
      getAccessToken,
    },
    options
  );
