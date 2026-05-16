/**
 * Redaction wrapper for MCP tool result payloads.
 *
 * Wraps `redactSecrets` from `@/shared/redact` so it can walk a
 * JSON-shaped structuredContent tree and scrub secrets from string
 * values. Tool results that contain raw API responses (env variables,
 * source-control integrations, auth metadata) flow through here before
 * crossing the wire.
 */

import { redactSecrets } from "@/shared/redact";

export const redactString = (value: string): string => redactSecrets(value);

export const redactStructured = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactStructured);
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactStructured(nested);
  }
  return out;
};
