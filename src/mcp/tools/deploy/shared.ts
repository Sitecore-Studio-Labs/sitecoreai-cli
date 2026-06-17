/**
 * Shared helpers for the deploy sub-domain tool registrations.
 *
 * The deploy surface is split into sibling files by sub-domain
 * (organization / project / environment / deployment / source-control);
 * each calls one of the helpers here so pagination, array coercion, and
 * the Deploy API options shape stay identical across every tool.
 */

import type { DeployApiClientOptions } from "@/deploy/api";

export const paginate = <T>(
  values: readonly T[],
  limit: number,
  cursor?: string
): { items: T[]; nextCursor?: string } => {
  const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
  const slice = values.slice(start, start + limit);
  const nextStart = start + slice.length;
  return {
    items: slice,
    nextCursor: nextStart < values.length ? String(nextStart) : undefined,
  };
};

export const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export const apiOptionsFromContext = (token: string): DeployApiClientOptions => ({
  accessToken: token,
});
