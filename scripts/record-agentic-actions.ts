/**
 * Agentic Studio write recorder — a reverse-engineering tool.
 *
 * `scan-agentic-actions.ts` finds server-action *hashes* in the page JS
 * but not their argument payloads, and misses actions behind buttons that
 * load lazily. This tool fills that gap: it opens a browser, you sign in
 * and **perform the operations yourself** in the real UI (create / edit /
 * delete a template, delete a space, …), and it passively records every
 * write request the browser makes to the BFF — method, path, the
 * `Next-Action` hash, `Next-Router-State-Tree`, and the **request body**
 * (the argument payload). That is everything needed to wire an action.
 *
 * It does not auto-drive the UI — the operator clicks; the script only
 * listens. It never prints the `Cookie` / `Authorization` headers; only
 * captures writes to the Agentic Studio origin (the request bodies are
 * operation payloads — template names, ids — not secrets).
 *
 *   pnpm record:agentic-actions
 *   pnpm record:agentic-actions --region euw
 */
import type { Browser, Page, Request as PwRequest } from "playwright-core";
import { agentsBaseUrl, DEFAULT_AGENTS_REGION } from "@/agents/session";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CHANNELS = ["chrome", "msedge"] as const;
const AUTH_TIMEOUT_MS = 5 * 60_000;
/** Hard cap on a recording session if the operator never closes the browser. */
const SESSION_TIMEOUT_MS = 30 * 60_000;

const resolveRegion = (argv: string[]): string => {
  const flag = argv.indexOf("--region");
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1];
  return process.env.PROBE_REGION ?? DEFAULT_AGENTS_REGION;
};

const loadPlaywright = async (): Promise<typeof import("playwright-core")> => {
  try {
    return await import("playwright-core");
  } catch {
    console.error("playwright-core is not installed — run `pnpm add -O playwright-core`.");
    process.exit(1);
  }
};

interface Captured {
  n: number;
  method: string;
  path: string;
  nextAction?: string;
  routerTree?: string;
  contentType?: string;
  body?: string;
  status?: number;
}

const records: Captured[] = [];

const truncate = (value: string, max = 2400): string =>
  value.length > max ? `${value.slice(0, max)}… (${value.length} bytes total)` : value;

const printCaptured = (capture: Captured): void => {
  const kind = capture.nextAction ? `server-action ${capture.nextAction}` : "REST write";
  console.log(
    `\n#${capture.n}  [${capture.method}] ${capture.path}  (${kind})  → ${capture.status ?? "?"}`
  );
  if (capture.routerTree) console.log(`   next-router-state-tree: ${capture.routerTree}`);
  if (capture.contentType) console.log(`   content-type: ${capture.contentType}`);
  if (capture.body) console.log(`   body: ${truncate(capture.body)}`);
};

const printSummary = (): void => {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`Recorded ${records.length} write request(s)`);
  console.log("=".repeat(72));
  for (const capture of records) {
    const action = capture.nextAction ? `action=${capture.nextAction}` : "(REST)";
    console.log(
      `  #${capture.n}  ${capture.method.padEnd(6)} ${capture.path.padEnd(34)} ` +
        `${action}  → ${capture.status ?? "?"}`
    );
  }
  console.log("\nFull bodies are printed above — paste this whole transcript back.");
};

const main = async (): Promise<void> => {
  const baseUrl = agentsBaseUrl(resolveRegion(process.argv.slice(2)));
  console.log(`Agentic Studio write recorder — ${baseUrl}`);

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

  process.on("SIGINT", () => {
    printSummary();
    process.exit(0);
  });

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

    console.log("\nSigned in. Now perform the operations in the browser window:");
    console.log("  • create an HTML template, then edit it, then delete it");
    console.log("  • delete a space");
    console.log("Each write is captured below as it happens. Close the browser when done.\n");

    const handle = async (request: PwRequest): Promise<void> => {
      try {
        if (!WRITE_METHODS.has(request.method())) return;
        const url = request.url();
        if (!url.startsWith(baseUrl)) return;
        const headers = request.headers();
        const response = await request.response().catch(() => null);
        const capture: Captured = {
          n: records.length + 1,
          method: request.method(),
          path: url.slice(baseUrl.length) || "/",
          nextAction: headers["next-action"],
          routerTree: headers["next-router-state-tree"],
          contentType: headers["content-type"],
          body: request.postData() ?? undefined,
          status: response?.status(),
        };
        records.push(capture);
        printCaptured(capture);
      } catch {
        /* a request we could not read — skip it */
      }
    };
    const attach = (target: Page): void => {
      target.on("requestfinished", (request) => void handle(request));
    };
    attach(page);
    context.on("page", attach);

    // Run until the operator closes the browser, or the safety timeout.
    await new Promise<void>((resolve) => {
      browser.on("disconnected", () => resolve());
      setTimeout(resolve, SESSION_TIMEOUT_MS);
    });
  } finally {
    await browser.close().catch(() => undefined);
  }

  printSummary();
};

main().catch((error) => {
  console.error("RECORDER FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
