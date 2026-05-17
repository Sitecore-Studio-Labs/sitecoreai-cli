/**
 * Agentic Studio server-action scanner — a maintenance / reverse-engineering
 * tool.
 *
 * Several Agentic Studio writes are not REST endpoints but Next.js
 * **server actions**, addressed by an opaque hash that rotates on every
 * deploy (see `createSchema` / `createHtmlTemplate` in `src/agents/api/`).
 * This tool signs in, loads a set of pages, and greps their JS for every
 * server-action call site so undiscovered actions — html-template
 * list/update/delete, space delete, … — can be found and wired.
 *
 * The minified call site is `(0,x.createServerReference)("<hash>",x.callServer)`
 * — this runtime's `createServerReference` takes only `(id, callServer)`,
 * so the bundle carries the **hash but no action name**. The scanner
 * reports each hash and the pages it appears on; a hash unique to one
 * page (e.g. `/html-templates/create`) is that page's action. Mapping a
 * hash to an operation and its argument payload still needs a HAR — the
 * `Next-Action` request header is exactly one of these hashes.
 *
 * Read-only. Chunk bodies are re-fetched fresh (a cache-served `response`
 * yields no body through `response.text()`).
 *
 *   pnpm scan:agentic-actions
 *   pnpm scan:agentic-actions --region euw /html-templates /spaces
 */
import type { APIRequestContext, Browser, Page, Response as PwResponse } from "playwright-core";
import { agentsBaseUrl, DEFAULT_AGENTS_REGION } from "@/agents/session";

/** Pages scanned when none are passed on the command line. */
const DEFAULT_PAGES = [
  "/agents",
  "/html-templates",
  "/html-templates/create",
  "/schemas",
  "/schemas/create",
  "/skills",
  "/widgets",
  "/spaces",
];

/**
 * A server-action call site: `createServerReference` then an optional `)`
 * (the `(0,x.createServerReference)` comma-expression form) then `("<hash>"`.
 * The `\)?` requirement skips the runtime *definition*
 * (`createServerReference=function…`), which has no `(` after the name.
 */
const SERVER_REF = /createServerReference\)?\(\s*"([0-9a-f]{30,})"/g;
const CHANNELS = ["chrome", "msedge"] as const;
const AUTH_TIMEOUT_MS = 5 * 60_000;

interface ScanArgs {
  region: string;
  pages: string[];
}

const parseArgs = (argv: string[]): ScanArgs => {
  let region = process.env.PROBE_REGION ?? DEFAULT_AGENTS_REGION;
  const pages: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--region" && argv[i + 1]) {
      region = argv[i + 1];
      i += 1;
    } else if (argv[i].startsWith("/")) {
      pages.push(argv[i]);
    }
  }
  return { region, pages: pages.length > 0 ? pages : DEFAULT_PAGES };
};

const loadPlaywright = async (): Promise<typeof import("playwright-core")> => {
  try {
    return await import("playwright-core");
  } catch {
    console.error("playwright-core is not installed — run `pnpm add -O playwright-core`.");
    process.exit(1);
  }
};

/** Fetch each unique chunk once, fresh, regardless of the browser cache. */
const chunkCache = new Map<string, Promise<string>>();
const fetchChunk = (request: APIRequestContext, url: string): Promise<string> => {
  let body = chunkCache.get(url);
  if (!body) {
    body = request
      .get(url)
      .then((response) => response.text())
      .catch(() => "");
    chunkCache.set(url, body);
  }
  return body;
};

interface ActionHit {
  hash: string;
  /** Minified source around the call site — occasionally carries a hint. */
  context: string;
}

const scanPage = async (
  page: Page,
  request: APIRequestContext,
  url: string
): Promise<{ jsCount: number; bytes: number; hits: ActionHit[] }> => {
  const jsUrls = new Set<string>();
  const collect = (response: PwResponse): void => {
    const responseUrl = response.url();
    let pathname = responseUrl;
    try {
      pathname = new URL(responseUrl).pathname;
    } catch {
      /* keep the raw url */
    }
    if (pathname.endsWith(".js")) jsUrls.add(responseUrl);
  };
  page.on("response", collect);
  await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => undefined);
  await page.waitForTimeout(1_500); // let any lazily-imported chunks land
  page.off("response", collect);

  const bodies = await Promise.all([...jsUrls].map((chunkUrl) => fetchChunk(request, chunkUrl)));
  const html = await page.content().catch(() => "");

  let bytes = 0;
  const hits: ActionHit[] = [];
  for (const text of [...bodies, html]) {
    bytes += text.length;
    for (const match of text.matchAll(SERVER_REF)) {
      const at = match.index ?? 0;
      const context = text.slice(Math.max(0, at - 90), at + 130).replace(/\s+/g, " ");
      hits.push({ hash: match[1], context });
    }
  }
  return { jsCount: jsUrls.size, bytes, hits };
};

const main = async (): Promise<void> => {
  const { region, pages } = parseArgs(process.argv.slice(2));
  const baseUrl = agentsBaseUrl(region);
  console.log(`Agentic Studio action scan — ${baseUrl}`);

  const { chromium } = await loadPlaywright();
  let browser: Browser | undefined;
  for (const channel of CHANNELS) {
    try {
      browser = await chromium.launch({ headless: false, channel });
      break;
    } catch {
      /* try the next system browser */
    }
  }
  if (!browser) {
    console.error("Could not launch Chrome or Edge — install one and retry.");
    process.exit(1);
  }

  const found = new Map<string, { hash: string; pages: Set<string>; context: string }>();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${baseUrl}/agents`, { waitUntil: "domcontentloaded" });

    console.log("Sign in to Sitecore in the browser window…");
    const deadline = Date.now() + AUTH_TIMEOUT_MS;
    let authed = false;
    while (Date.now() < deadline) {
      const probe = await context.request
        .get(`${baseUrl}/api/agents`, { failOnStatusCode: false, maxRedirects: 0 })
        .catch(() => undefined);
      if (probe && probe.status() === 200) {
        authed = true;
        break;
      }
      await page.waitForTimeout(2_000);
    }
    if (!authed) {
      throw new Error("Timed out waiting for sign-in.");
    }
    console.log("Signed in — scanning pages…\n");

    for (const path of pages) {
      const scan = await scanPage(page, context.request, `${baseUrl}${path}`);
      for (const hit of scan.hits) {
        const entry = found.get(hit.hash) ?? {
          hash: hit.hash,
          pages: new Set<string>(),
          context: hit.context,
        };
        entry.pages.add(path);
        found.set(hit.hash, entry);
      }
      const kb = Math.round(scan.bytes / 1024);
      const distinct = new Set(scan.hits.map((h) => h.hash)).size;
      console.log(
        `  ${path.padEnd(26)} js=${String(scan.jsCount).padStart(3)} ${String(kb).padStart(6)}KB ` +
          `actions=${distinct}`
      );
    }
  } finally {
    await browser.close();
  }

  // Page-specific actions first — a hash on one page is that page's action;
  // a hash on many pages is a shared framework action (revalidate, …).
  const actions = [...found.values()].sort((a, b) => a.pages.size - b.pages.size);
  console.log(`\n${"=".repeat(72)}`);
  console.log(`${actions.length} distinct server-action hash(es)`);
  console.log("=".repeat(72));
  for (const action of actions) {
    const scope = action.pages.size === 1 ? "PAGE-SPECIFIC" : `shared ×${action.pages.size}`;
    console.log(`\n  ${action.hash}   [${scope}]`);
    console.log(`    pages: ${[...action.pages].sort().join(", ")}`);
    console.log(`    near:  ${action.context}`);
  }
  console.log(
    "\nThe bundle carries the hash but no action name or payload. To map a\n" +
      "hash to an operation: capture a HAR, do the action in the UI, and read\n" +
      "the `Next-Action` request header — it equals one of these hashes. The\n" +
      "request body is the argument payload. See docs/agentic-studio-har-capture.md."
  );
};

main().catch((error) => {
  console.error("SCAN FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
