/**
 * Management GraphQL transport for serialization commands.
 *
 * Thin wrapper over `src/shared/graphql.ts` — supplies the Management
 * service path and label. Parallels `src/recipe/api/graphql.ts` which
 * targets the Authoring endpoint.
 */

import type { SitecoreApiClientOptions } from "./types";
import { runSitecoreGraphQL, type GraphQLRequestOptions } from "@/shared/graphql";
import { getAccessToken } from "./auth";

const SERVICE_PATH = "/sitecore/api/management";

export type { GraphQLRequestOptions };

export const runGraphQL = <T>(
  environment: SitecoreApiClientOptions,
  query: string,
  variables?: Record<string, unknown>,
  options?: GraphQLRequestOptions
): Promise<T> =>
  runSitecoreGraphQL<T>(
    environment,
    query,
    variables,
    {
      servicePath: SERVICE_PATH,
      label: "Management",
      requireToken: false,
      getAccessToken,
    },
    options
  );
