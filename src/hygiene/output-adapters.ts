import fs from "node:fs";
import path from "node:path";

/**
 * Output adapters for audit reports.
 *
 * Audit results today are emitted as JSON via `printReport` to stdout.
 * The output adapters here let callers redirect to a file and/or
 * transform to CSV / Markdown for human-readable reporting.
 *
 * Adapters operate on the JSON envelope shape that `printReport`
 * produces:
 *
 *   {
 *     command: "audit.broken-links.list",
 *     environment: "sandbox",
 *     count: 42,
 *     results: [ { itemId, path, ... } ],
 *     <extra fields>
 *   }
 *
 * For `audit all`, the envelope wraps multiple per-audit reports:
 *
 *   {
 *     command: "audit.all",
 *     environment: "sandbox",
 *     audits: { "broken-links": <envelope>, ... },
 *     summary: { totalFindings, byAudit }
 *   }
 */

export type OutputFormat = "json" | "csv" | "markdown";

export interface AuditEnvelope {
  command: string;
  environment: string;
  count?: number;
  results: unknown[];
  summary?: string;
  [key: string]: unknown;
}

/** Format a single-audit envelope. */
export const formatAuditOutput = (envelope: AuditEnvelope, format: OutputFormat): string => {
  switch (format) {
    case "json":
      return JSON.stringify(envelope, null, 2);
    case "csv":
      return toCsv(envelope.results);
    case "markdown":
      return toMarkdown(envelope);
    default:
      return JSON.stringify(envelope, null, 2);
  }
};

/**
 * CSV serializer. Inspects the result rows to derive a column set,
 * then emits a header row + one row per finding. Nested objects get
 * JSON-stringified; arrays get joined with `;`.
 */
const toCsv = (rows: unknown[]): string => {
  if (rows.length === 0) return "";
  // Flatten one level; collect the union of top-level keys.
  const columns = new Set<string>();
  for (const r of rows) {
    if (r && typeof r === "object" && !Array.isArray(r)) {
      for (const k of Object.keys(r)) columns.add(k);
    }
  }
  const cols = Array.from(columns);
  const lines: string[] = [cols.map(escapeCsv).join(",")];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const obj = row as Record<string, unknown>;
    lines.push(
      cols
        .map((c) => {
          const v = obj[c];
          if (v === null || v === undefined) return "";
          if (typeof v === "string") return escapeCsv(v);
          if (typeof v === "number" || typeof v === "boolean") return String(v);
          if (Array.isArray(v)) {
            return escapeCsv(
              v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("; ")
            );
          }
          return escapeCsv(JSON.stringify(v));
        })
        .join(",")
    );
  }
  return lines.join("\n");
};

const escapeCsv = (value: string): string => {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
};

/**
 * Markdown serializer. Produces a heading + summary + a fenced JSON
 * block for the raw results. Falls through to a table when result
 * rows are simple flat objects.
 */
const toMarkdown = (envelope: AuditEnvelope): string => {
  const lines: string[] = [];
  const title = (envelope.command ?? "audit").replace(/^audit\./, "").replace(/[._]/g, " ");
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- **Environment**: \`${envelope.environment}\``);
  if (envelope.summary) lines.push(`- **Summary**: ${envelope.summary}`);
  if (typeof envelope.count === "number") lines.push(`- **Count**: ${envelope.count}`);
  // Inline any top-level scalar extras.
  for (const [k, v] of Object.entries(envelope)) {
    if (["command", "environment", "count", "results", "summary"].includes(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    lines.push(`- **${k}**: ${v}`);
  }
  lines.push("");

  const rows = envelope.results;
  if (Array.isArray(rows) && rows.length > 0 && isTableable(rows)) {
    const cols = collectTopLevelKeys(rows);
    lines.push(`| ${cols.join(" | ")} |`);
    lines.push(`| ${cols.map(() => "---").join(" | ")} |`);
    for (const r of rows) {
      const obj = r as Record<string, unknown>;
      lines.push(`| ${cols.map((c) => formatMarkdownCell(obj[c])).join(" | ")} |`);
    }
  } else if (Array.isArray(rows) && rows.length > 0) {
    // Complex rows — emit as fenced JSON.
    lines.push("```json");
    lines.push(JSON.stringify(rows, null, 2));
    lines.push("```");
  } else {
    lines.push("_No findings._");
  }
  return lines.join("\n") + "\n";
};

const collectTopLevelKeys = (rows: unknown[]): string[] => {
  const cols = new Set<string>();
  for (const r of rows) {
    if (r && typeof r === "object" && !Array.isArray(r)) {
      for (const k of Object.keys(r)) cols.add(k);
    }
  }
  return Array.from(cols);
};

const isTableable = (rows: unknown[]): boolean => {
  // Heuristic: rows are tableable when every top-level value is a
  // scalar OR a short array of scalars. Avoids unreadable mega-rows.
  for (const r of rows) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return false;
    for (const v of Object.values(r as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "object" && !Array.isArray(v)) return false;
      if (Array.isArray(v) && v.length > 3) return false;
    }
  }
  return true;
};

const formatMarkdownCell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
  if (Array.isArray(value))
    return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/**
 * Write an audit envelope to a file or stdout (when filePath is unset).
 * Returns the formatted string for callers that want to also display
 * it in the logger.
 */
export const writeAuditOutput = (
  envelope: AuditEnvelope,
  options: { format?: OutputFormat; output?: string } = {}
): string => {
  const format = options.format ?? "json";
  const body = formatAuditOutput(envelope, format);
  if (options.output) {
    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
    fs.writeFileSync(options.output, body, "utf8");
  }
  return body;
};

export const inferFormatFromExtension = (filePath: string): OutputFormat | undefined => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".csv") return "csv";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  return undefined;
};
