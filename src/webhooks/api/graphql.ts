import type { EnvironmentConfiguration } from "@/config/types";
import { runSitecoreGraphQL, type GraphQLRequestOptions } from "@/shared/graphql";
import { getAccessToken } from "@/serialization/api/auth";

const DEFAULT_AUTHORING_PATH = "/sitecore/api/authoring/graphql/v1";

const resolveAuthoringPath = (): string =>
  process.env.SITECOREAI_AUTHORING_PATH ?? DEFAULT_AUTHORING_PATH;

export type WebhookRequestOptions = GraphQLRequestOptions;

const DEFAULT_AUTHORING_RETRY = { maxAttempts: 5 } as const;

export const runWebhookAuthoringGraphQL = <T>(
  environment: EnvironmentConfiguration,
  query: string,
  variables?: Record<string, unknown>,
  options?: WebhookRequestOptions
): Promise<T> =>
  runSitecoreGraphQL<T>(
    environment,
    query,
    variables,
    {
      servicePath: resolveAuthoringPath(),
      label: "Webhook",
      requireToken: true,
      getAccessToken,
    },
    {
      ...options,
      retry: { ...DEFAULT_AUTHORING_RETRY, ...(options?.retry ?? {}) },
    }
  );
