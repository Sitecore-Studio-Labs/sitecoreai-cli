import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "./shared";

export interface AuditBrokenImagesOptions extends HygieneCommonOptions {
  /** Content root. Default `/sitecore/content`. */
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  language?: string;
  batchSize?: number;
  concurrency?: number;
  pageParallelism?: number;
  cache?: boolean;
  exclude?: string[];
  since?: string;
  owner?: string;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
  /** HTTP timeout in ms for each HEAD request. Default 5000. */
  requestTimeoutMs?: number;
  /** Max number of unique URLs probed. Default 500. */
  urlLimit?: number;
  /**
   * Domains to exclude from probing. Repeatable. Sitecore media
   * library URLs (typically same-origin) are always probed; this is
   * for skipping external image hosts you can't reach.
   */
  excludeDomains?: string[];
}

export interface BrokenImageReport {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  brokenImages: Array<{
    fieldName: string;
    url: string;
    status: number | "timeout" | "network-error";
  }>;
}

/**
 * Audit RichText fields for `<img src="...">` URLs that fail HTTP HEAD.
 *
 * Distinct from `audit unused-media` (media-library items with no
 * inbound refs) and `audit datasource-missing` (rendering datasources
 * not resolving). Here we follow external URLs in RichText content
 * and report 404 / timeout / network errors.
 *
 * Strategy:
 *   1. Enumerate items via `scanItemsAndFields`.
 *   2. For each non-system field, parse `<img src="...">` tags.
 *   3. De-dup URLs across all items, cap at `--url-limit`.
 *   4. HEAD each URL with `--request-timeout-ms` timeout.
 *   5. Report items whose URLs returned non-2xx (or timed out).
 *
 * Notes:
 *   - HEAD is preferred but some CDNs reject HEAD with 405; we fall
 *     back to GET with Range: bytes=0-0 in that case.
 *   - `data:` URLs (base64-embedded images) are skipped — they don't
 *     have a remote target.
 *   - Sitecore mediaitem URLs (`/-/media/...`) are probed against the
 *     tenant host (same origin). External CDN URLs hit their own host.
 *   - `--exclude-domains cdn.example.com` skips that host entirely.
 */

const IMG_TAG_PATTERN = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;

export const runAuditBrokenImages = async (
  options: AuditBrokenImagesOptions
): Promise<BrokenImageReport[]> => {
  const logger = toLogger(options);
  const { envName, environment, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";
  const requestTimeoutMs = options.requestTimeoutMs ?? 5000;
  const urlLimit = options.urlLimit ?? 500;
  const excludeDomains = new Set((options.excludeDomains ?? []).map((d) => d.toLowerCase()));

  const { scanned, fieldsByItemId, cache } = await scanItemsAndFields({
    client,
    envName,
    root,
    logger,
    options,
  });

  // Collect (item, field, url) triples.
  type Pending = {
    itemId: string;
    path: string;
    templateName: string | null;
    language: string | null;
    fieldName: string;
    url: string;
  };
  const pending: Pending[] = [];
  const uniqueUrls = new Set<string>();
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    for (const field of fields) {
      if (!field.value) continue;
      if (field.name.startsWith("__")) continue;
      let m: RegExpExecArray | null;
      const re = new RegExp(IMG_TAG_PATTERN);
      while ((m = re.exec(field.value)) !== null) {
        const url = m[1];
        if (!url || url.startsWith("data:")) continue;
        pending.push({
          itemId: item.itemId,
          path: item.path,
          templateName: item.templateName,
          language: item.language,
          fieldName: field.name,
          url,
        });
        uniqueUrls.add(url);
      }
    }
  }
  logger.verbose(`Found ${pending.length} <img> refs (${uniqueUrls.size} distinct).`);

  // Resolve relative URLs (Sitecore mediaitem `/-/media/...`) against the
  // tenant host.
  const tenantOrigin = environment.host
    ? environment.host.startsWith("http")
      ? environment.host.replace(/\/$/, "")
      : `https://${environment.host}`
    : null;

  const resolveUrl = (u: string): string | null => {
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    if (u.startsWith("//")) return `https:${u}`;
    if (u.startsWith("/") && tenantOrigin) return `${tenantOrigin}${u}`;
    return null; // relative path we can't resolve
  };

  const absoluteUrls = Array.from(uniqueUrls).slice(0, urlLimit);
  const statusByUrl = new Map<string, number | "timeout" | "network-error" | "skipped">();
  await mapWithConcurrency(
    absoluteUrls,
    async (rawUrl) => {
      const abs = resolveUrl(rawUrl);
      if (!abs) {
        statusByUrl.set(rawUrl, "skipped");
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(abs);
      } catch {
        statusByUrl.set(rawUrl, "skipped");
        return;
      }
      if (excludeDomains.has(parsed.host.toLowerCase())) {
        statusByUrl.set(rawUrl, "skipped");
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        let res = await fetch(abs, { method: "HEAD", signal: controller.signal });
        // Some CDNs reject HEAD; fall back to a Range-limited GET.
        if (res.status === 405 || res.status === 501) {
          res = await fetch(abs, {
            method: "GET",
            headers: { Range: "bytes=0-0" },
            signal: controller.signal,
          });
        }
        statusByUrl.set(rawUrl, res.status);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          statusByUrl.set(rawUrl, "timeout");
        } else {
          statusByUrl.set(rawUrl, "network-error");
        }
      } finally {
        clearTimeout(timer);
      }
    },
    8
  );

  // Build per-item reports for items with non-2xx URLs.
  const byItem = new Map<string, BrokenImageReport>();
  for (const p of pending) {
    const status = statusByUrl.get(p.url);
    if (status === undefined || status === "skipped") continue;
    if (typeof status === "number" && status >= 200 && status < 400) continue;
    const entry = { fieldName: p.fieldName, url: p.url, status };
    const existing = byItem.get(p.itemId);
    if (existing) {
      if (
        !existing.brokenImages.some((b) => b.url === entry.url && b.fieldName === entry.fieldName)
      ) {
        existing.brokenImages.push(entry);
      }
    } else {
      byItem.set(p.itemId, {
        itemId: p.itemId,
        path: p.path,
        templateName: p.templateName,
        language: p.language,
        brokenImages: [entry],
      });
    }
  }
  const reports = Array.from(byItem.values()).sort((a, b) => a.path.localeCompare(b.path));
  await cache?.flush();

  printReport({
    logger,
    command: "audit.broken-images.list",
    envName,
    results: reports,
    summary: `Scanned ${scanned.length} items; probed ${absoluteUrls.length} URLs; ${reports.length} items have broken images.`,
    formatLine: (r) =>
      `${r.path} — ${r.brokenImages.length} broken: ${r.brokenImages
        .slice(0, 2)
        .map((b) => `${b.fieldName}→${b.url} (${b.status})`)
        .join("; ")}${r.brokenImages.length > 2 ? "…" : ""}`,
    extra: {
      root,
      scannedCount: scanned.length,
      urlsProbed: absoluteUrls.length,
    },
    options,
  });

  return reports;
};
