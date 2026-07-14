import { createHash } from "node:crypto";

/**
 * Internal RFC 4122 UUIDv5 (SHA-1 namespace hashing) — replaced the
 * external `uuid` package after its ESM-only major twice reached `dev`
 * via dependabot and broke strict-CJS consumers of the compiled `dist/`
 * with `ERR_REQUIRE_ESM` (the orchestrator's Vercel functions; see
 * `scripts/smoke-require.cjs` for the guard that now catches this class
 * in CI). scai only ever used `v5`, and v5 is fully specified — this
 * implementation is byte-identical to the package's output, which the
 * existing GUID-pinning tests prove (every recipe refKey derivation
 * would change otherwise, breaking recipe identity on re-push).
 *
 * Signature matches the `uuid` package's `v5(name, namespace)` string
 * form; the Buffer output variants scai never used are omitted.
 */
export const v5 = (name: string | Uint8Array, namespace: string): string => {
  const ns = namespace.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(ns)) {
    throw new TypeError(`Invalid UUID namespace: '${namespace}'`);
  }
  const bytes = createHash("sha1")
    .update(Buffer.from(ns, "hex"))
    .update(typeof name === "string" ? Buffer.from(name, "utf8") : Buffer.from(name))
    .digest()
    .subarray(0, 16);
  // Stamp version (5) and the RFC 4122 variant bits over the hash.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
