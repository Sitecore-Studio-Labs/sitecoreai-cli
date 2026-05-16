/**
 * Authoring GraphQL transport for recipe execution.
 *
 * Thin wrapper over `src/shared/graphql.ts` — supplies the Authoring
 * service path and label. Parallels `src/serialization/api/graphql.ts`
 * which targets the Management endpoint.
 *
 * XM Cloud Authoring API path. If a SitecoreAI tenant ever exposes the
 * endpoint at a different path, override via `SITECOREAI_AUTHORING_PATH`.
 */

import type { EnvironmentConfiguration } from "@/config/types";
import { runSitecoreGraphQL, type GraphQLRequestOptions } from "@/shared/graphql";
import { getAccessToken } from "./auth";

const DEFAULT_AUTHORING_PATH = "/sitecore/api/authoring/graphql/v1";

const resolveAuthoringPath = (): string =>
  process.env.SITECOREAI_AUTHORING_PATH ?? DEFAULT_AUTHORING_PATH;

export type AuthoringRequestOptions = GraphQLRequestOptions;

/**
 * Authoring GraphQL retry policy. Default 5 attempts with exponential
 * backoff + jitter (honoring `Retry-After` on 429/503). The recipe
 * executor fans out batched reads and serial mutations against XM
 * Cloud — both paths benefit from absorbing transient throttling /
 * gateway hiccups without aborting the whole push. Mutation idempotency
 * is preserved by the executor's rollback semantics: a "succeeded but
 * lost the response" duplicate retry surfaces as "item already exists",
 * the executor rolls back, and the operator sees the failure.
 */
const DEFAULT_AUTHORING_RETRY = { maxAttempts: 5 } as const;

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
    {
      ...options,
      retry: { ...DEFAULT_AUTHORING_RETRY, ...(options?.retry ?? {}) },
    }
  );
