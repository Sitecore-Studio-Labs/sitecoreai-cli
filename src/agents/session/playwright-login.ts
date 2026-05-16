/**
 * TEMPORARY — interactive browser login for Agentic Studio.
 *
 * Agentic Studio has no machine-credential path: its BFF is gated by a
 * first-party session cookie set by an interactive Auth0 login (MFA
 * included). Until Sitecore exposes ordinary user credentials, scai
 * captures that session by driving a real browser with Playwright.
 *
 * This is the ONLY file in `src/agents/` that touches Playwright, and
 * `playwright-core` is a deliberately isolated optional dependency. When
 * the product opens up, delete this file and the dependency — see
 * `session/types.ts` for the retirement steps.
 *
 * `playwright-core` ships no browser binaries, so this drives the
 * operator's installed Chrome/Edge via Playwright's `channel` option.
 */
import type { Browser, Page, Response as PlaywrightResponse } from "playwright-core";
import { createScaiError } from "@/shared/errors";
import { agentsBaseUrl, type AgentsCredential } from "./types";

export interface PlaywrightLoginOptions {
  region: string;
  /** Max time to wait for the operator to finish signing in (ms). */
  timeoutMs?: number;
}

/** System browser channels to try, in order. */
const CHANNELS = ["chrome", "msedge"] as const;

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;

const loadPlaywright = async (): Promise<typeof import("playwright-core")> => {
  try {
    return await import("playwright-core");
  } catch {
    throw createScaiError(
      "Agentic Studio login needs Playwright, which is not installed.",
      "AUTH_REQUIRED",
      {
        hint: "Run `pnpm add -O playwright-core` (a temporary dependency — see src/agents/session/types.ts).",
      }
    );
  }
};

/**
 * Discover a Next.js server-action hash from a create page's JS chunks.
 *
 * schema / html-template writes replay a server action whose hash rotates
 * on every Agentic Studio deploy. Capturing it fresh at login (rather
 * than hard-coding it) keeps those writes self-healing. Best-effort:
 * returns `undefined` if the page or pattern can't be read, and the
 * writes then fall back to their env override / constant.
 */
const discoverActionHash = async (
  page: Page,
  url: string,
  actionNameHint: string
): Promise<string | undefined> => {
  const chunkBodies: Promise<string>[] = [];
  const collect = (response: PlaywrightResponse): void => {
    const responseUrl = response.url();
    if (responseUrl.includes("/_next/static/chunks/") && responseUrl.endsWith(".js")) {
      chunkBodies.push(response.text().catch(() => ""));
    }
  };
  page.on("response", collect);
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => undefined);
  page.off("response", collect);

  // `createServerReference("<hash>", callServer, …, "<actionName>")`
  const pattern = /createServerReference\("([0-9a-f]{30,})"[^)]*?"([^"]*)"/g;
  for (const chunk of await Promise.all(chunkBodies)) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(chunk)) !== null) {
      if (match[2].toLowerCase().includes(actionNameHint)) return match[1];
    }
  }
  return undefined;
};

/**
 * Launch a headed browser, let the operator sign in, and capture the
 * resulting BFF session cookie as an `AgentsCredential`.
 */
export const runPlaywrightLogin = async (
  options: PlaywrightLoginOptions
): Promise<AgentsCredential> => {
  const baseUrl = agentsBaseUrl(options.region);
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const { chromium } = await loadPlaywright();

  let browser: Browser | undefined;
  let lastError: unknown;
  for (const channel of CHANNELS) {
    try {
      browser = await chromium.launch({ headless: false, channel });
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!browser) {
    throw createScaiError("Could not launch a browser for Agentic Studio login.", "AUTH_REQUIRED", {
      hint:
        "Install Google Chrome or Microsoft Edge. Underlying error: " +
        (lastError instanceof Error ? lastError.message : String(lastError)),
    });
  }

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${baseUrl}/agents`, { waitUntil: "domcontentloaded" });

    // The operator completes Auth0 (+ MFA) in the window. Detect completion
    // by polling an authenticated endpoint: /api/agents answers 200 ONLY
    // once the BFF session cookie is set. (token-refresh answers 2xx even
    // for an anonymous context, which would close the window before login.)
    const deadline = Date.now() + timeoutMs;
    let authenticated = false;
    while (Date.now() < deadline) {
      const probe = await context.request
        .get(`${baseUrl}/api/agents`, { failOnStatusCode: false, maxRedirects: 0 })
        .catch(() => undefined);
      if (probe && probe.status() === 200) {
        authenticated = true;
        break;
      }
      await page.waitForTimeout(2_000);
    }
    if (!authenticated) {
      throw createScaiError(
        "Timed out waiting for Agentic Studio login to complete.",
        "AUTH_REQUIRED",
        { hint: "Re-run `scai agents login` and finish signing in within the browser window." }
      );
    }

    const cookies = await context.cookies(baseUrl);
    const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    if (!cookieHeader) {
      throw createScaiError(
        "Agentic Studio login completed but no session cookie was captured.",
        "AUTH_REQUIRED"
      );
    }

    // The real browser User-Agent — replayed on every API call so the
    // edge WAF accepts requests made from Node.
    const userAgent = String(await page.evaluate("navigator.userAgent"));

    // Capture the server-action hashes for the create pages — they rotate
    // per Agentic Studio deploy, so discovering them here keeps the
    // schema / html-template writes self-healing across logins.
    const actionHashes: Record<string, string> = {};
    const schemaHash = await discoverActionHash(page, `${baseUrl}/schemas/create`, "schema");
    if (schemaHash) actionHashes["/schemas/create"] = schemaHash;
    const templateHash = await discoverActionHash(
      page,
      `${baseUrl}/html-templates/create`,
      "template"
    );
    if (templateHash) actionHashes["/html-templates/create"] = templateHash;

    return {
      kind: "cookie",
      region: options.region,
      cookieHeader,
      userAgent,
      capturedAt: new Date().toISOString(),
      ...(Object.keys(actionHashes).length > 0 ? { actionHashes } : {}),
    };
  } finally {
    await browser.close();
  }
};
