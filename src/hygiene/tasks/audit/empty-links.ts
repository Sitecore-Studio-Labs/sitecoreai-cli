import {
  type HygieneCommonOptions,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "../shared";

export interface AuditEmptyLinksOptions extends HygieneCommonOptions {
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
  /**
   * Restrict by template name pattern. Default scans every item.
   * Most operators want to scope this — e.g. `--template-pattern
   * CTA|Button|Card` — because every Page template has at least one
   * "navigation" link field that's expected to be empty on standalone
   * landing pages.
   */
  templatePattern?: string;
}

export interface EmptyLinkReport {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  emptyFields: Array<{ fieldName: string; reason: "no-link-tag" | "empty-attributes" }>;
}

/**
 * Audit for Sitecore General Link fields whose value is structurally
 * present but functionally empty.
 *
 * General Link fields store XML like:
 *
 *   <link linktype="internal" id="{guid}" />
 *   <link linktype="external" url="https://..." />
 *   <link linktype="anchor" anchor="section-2" />
 *   <link linktype="mailto" url="mailto:..." />
 *
 * The cases this catches:
 *
 *   1. **No `<link>` tag at all** — the field value is empty or just
 *      whitespace. The button/CTA renders, the link goes nowhere.
 *   2. **`<link>` with no target** — every targeting attribute (`url`,
 *      `id`, `anchor`, `mediaid`) is empty or absent. Same outcome
 *      from the visitor's perspective.
 *
 * What this is NOT:
 *   - `audit broken-links` — internal `id="{guid}"` pointing at an item
 *     that doesn't exist (the link is filled in, just to a ghost).
 *   - `audit empty-items` — items where every field is empty.
 *
 * Strategy:
 *   1. Scan items + fields via `scanItemsAndFields`.
 *   2. For each field value, look for `<link …/>` markup. The
 *      `linktype` attribute disambiguates "link field" from raw text.
 *   3. Classify: missing tag (reason: no-link-tag) vs empty-targeting
 *      attributes (reason: empty-attributes).
 *
 * Field detection: General Link fields ALWAYS produce a `<link>` tag
 * when populated. A non-link field value happens to contain "<link"
 * only when an operator stuffed XML into a Single-Line Text field —
 * vanishingly rare, and the false positive rate is "the value really
 * does encode a broken link," so we don't filter on field type.
 */

const LINK_TAG_PATTERN = /<link\b[^>]*\/?>/gi;
const TARGET_ATTRS = ["url", "id", "anchor", "mediaid", "querystring"] as const;
const LINKTYPE_ATTR_PATTERN = /\blinktype=["']([^"']*)["']/i;

const hasMeaningfulTarget = (tag: string): boolean => {
  for (const attr of TARGET_ATTRS) {
    const re = new RegExp(`\\b${attr}=["']([^"']*)["']`, "i");
    const m = re.exec(tag);
    if (m && m[1] && m[1].trim().length > 0) return true;
  }
  return false;
};

const valueLooksLikeLinkField = (value: string): boolean => {
  // A populated General Link field has at least one `<link …/>` tag.
  // Empty / never-populated fields are empty strings — we want to
  // ignore those unless the operator's pattern says otherwise (e.g.
  // a CTA template whose Link field should always be set).
  return /<link\b/i.test(value);
};

/**
 * Count the `<link>` tags in a field value that carry a `linktype`
 * attribute but no meaningful target — one finding per such tag.
 * Extracted from the scan loop to keep nesting shallow; returns the
 * number of `empty-attributes` findings to push for this field.
 */
const countEmptyTargetedLinks = (value: string): number => {
  const matches = value.match(LINK_TAG_PATTERN);
  if (!matches) return 0;
  let count = 0;
  for (const tag of matches) {
    // Ignore tags with no linktype attribute — they're not real
    // General Link payloads (matched by accident on raw <link>
    // tags in RichText/HTML, e.g. `<link rel="stylesheet" …>`).
    if (!LINKTYPE_ATTR_PATTERN.exec(tag)) continue;
    if (!hasMeaningfulTarget(tag)) count += 1;
  }
  return count;
};

export const runAuditEmptyLinks = async (
  options: AuditEmptyLinksOptions
): Promise<EmptyLinkReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/content";
  const templateRegex = options.templatePattern ? new RegExp(options.templatePattern, "i") : null;

  const { scanned, fieldsByItemId, cache } = await scanItemsAndFields({
    client,
    envName,
    root,
    logger,
    options,
  });

  const reports: EmptyLinkReport[] = [];
  for (const item of scanned) {
    if (templateRegex && !templateRegex.test(item.templateName ?? "")) continue;
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    const offending: EmptyLinkReport["emptyFields"] = [];
    for (const field of fields) {
      if (field.name.startsWith("__")) continue;
      // Two cases produce a finding:
      //   - Field value contains a `<link>` whose targeting attributes
      //     are empty — reason: empty-attributes.
      //   - Field name matches a "this is supposed to be a link" hint
      //     (Link / CallToAction / CTA / Url) and the value is blank —
      //     reason: no-link-tag.
      // We DON'T flag every empty field on every template — that's
      // `audit empty-items`. Without the name hint we'd false-positive
      // on every Single-Line Text field that happens to be empty.
      const value = field.value ?? "";
      if (valueLooksLikeLinkField(value)) {
        const emptyCount = countEmptyTargetedLinks(value);
        for (let i = 0; i < emptyCount; i += 1) {
          offending.push({ fieldName: field.name, reason: "empty-attributes" });
        }
      } else if (
        // Field-name hint: ends in (or equals) "Link" / "Cta" / "CallToAction" / "Url" /
        // "Href" — case-insensitive. The end-anchor catches camelCase variants like
        // "PrimaryCTA" / "BaseUrl" / "HeroLink" without false-positive matching against
        // "Surl" or "Blinking". A separator (start-of-string, [A-Z_-]) at the head
        // prevents matching mid-word.
        /(?:^|[A-Z_-])(link|cta|calltoaction|call-to-action|url|href)$/i.test(field.name) &&
        value.trim().length === 0
      ) {
        offending.push({ fieldName: field.name, reason: "no-link-tag" });
      }
    }
    if (offending.length > 0) {
      reports.push({
        itemId: item.itemId,
        path: item.path,
        templateName: item.templateName,
        language: item.language,
        emptyFields: offending,
      });
    }
  }
  reports.sort((a, b) => a.path.localeCompare(b.path));

  await cache?.flush();

  printReport({
    logger,
    command: "audit.empty-links.list",
    envName,
    results: reports,
    summary: `Scanned ${scanned.length} items; ${reports.length} have empty link fields.`,
    formatLine: (r) =>
      `${r.path} — ${r.emptyFields.map((f) => `${f.fieldName}(${f.reason})`).join(", ")}`,
    extra: { root, scannedCount: scanned.length },
    options,
  });

  return reports;
};
