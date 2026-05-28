import type { EnvironmentConfiguration } from "@/config/types";
import { runSitecoreGraphQL, type GraphQLRequestOptions } from "@/shared/graphql";
import { getAccessToken } from "@/auth";

const DEFAULT_AUTHORING_PATH = "/sitecore/api/authoring/graphql/v1";

const resolveAuthoringPath = (): string =>
  process.env.SITECOREAI_AUTHORING_PATH ?? DEFAULT_AUTHORING_PATH;

export type AuthoringRequestOptions = GraphQLRequestOptions;

const DEFAULT_AUTHORING_RETRY = { maxAttempts: 5 } as const;

export const runHygieneAuthoringGraphQL = <T>(
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
    {
      ...options,
      retry: { ...DEFAULT_AUTHORING_RETRY, ...(options?.retry ?? {}) },
    }
  );
