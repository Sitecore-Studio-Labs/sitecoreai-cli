/**
 * Maps `ScaiError` (and unknown thrown values) onto the MCP
 * `CallToolResult` error envelope shape consumed by every tool handler.
 *
 * Envelope:
 *   - `isError: true`
 *   - `content[0]`: text composed as "What happened. Why. Next."
 *   - `structuredContent`: typed `{ code, exitCode, what, why, hint, docsUri? }`
 *
 * Both the text body and the structured content flow through
 * `redactStructured` so secrets that leaked into error messages never
 * cross the wire.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toScaiError, type Remediation, type ScaiError, type ScaiErrorCode } from "@/shared/errors";
import { redactString, redactStructured } from "./redact";

const DOCS_URI_BY_CODE: Partial<Record<ScaiErrorCode, string>> = {
  AUTH_REQUIRED: "scai://help/overview",
  CONFIG_NOT_FOUND: "scai://help/overview",
  CONFIG_INVALID: "scai://help/overview",
  ENV_NOT_FOUND: "scai://env/current/manifest",
};

const NEXT_HINT_BY_CODE: Record<ScaiErrorCode, string> = {
  AUTH_REQUIRED: "Run `scai setup login` for the bound environment, then restart the MCP server.",
  CONFIG_NOT_FOUND:
    "Confirm a sitecoreai.cli.json exists in the working tree the MCP server was launched from.",
  CONFIG_INVALID:
    "Fix the offending field in sitecoreai.cli.json (see `why`) and restart the MCP server.",
  INPUT_INVALID:
    "Re-call the tool with the missing or corrected field. The `why` field describes the offending input.",
  NETWORK: "Retry shortly; if the failure persists, check Sitecore Cloud status.",
  ENV_NOT_FOUND: "Confirm the environment name is configured in sitecoreai.cli.json.",
  DEPLOY_FAILED:
    "Inspect deploy logs via `deploy_run_inspect` and address the failure before retrying.",
  DEPLOY_CANCELED:
    "The deployment was canceled in XM Cloud Deploy before reaching Complete. Re-run the deploy if the cancel was unintended; otherwise treat as user-initiated rollback.",
  SITES_API_FAILED:
    "Confirm the bound environment has Sites API access and the access token is fresh.",
  BRIEF_API_FAILED:
    "Confirm the bound environment has Content Operations Brief API access and the access token is fresh.",
  CAMPAIGN_API_FAILED:
    "Confirm the bound environment has Orchestrate (Campaign) API access and the access token is fresh.",
  AGENTS_API_FAILED:
    "Confirm the Agentic Studio session is valid (`scai agents login`) and your account holds the Builder role and license.",
  CANCELLED:
    "The tool was cancelled by the client. Any partial application is documented in `why`; re-run the tool with the same arguments to resume.",
  AUTH_BRAND_REQUIRED:
    "Authenticate with the Sitecore Brand service for the bound environment, then re-run the tool.",
  AUTH_DENIED:
    "The bound environment has denyMcpElevation set; MCP write tools can't mutate this tenant. Run the destructive op via the CLI with --allow-write, or clear denyMcpElevation in sitecoreai.cli.json if MCP-driven writes are acceptable for this env.",
  POLICY_DENIED:
    "The target environment is not on the scai workspace-policy allowlist, or its tenant identity drifted from what was pinned at enrollment. The operator must enroll or re-pin it (`scai policy allow <env>` / `scai policy trust <env>`) — an agent cannot self-authorize an environment.",
  BRAND_API_FAILED:
    "Confirm the bound environment has Brand API access and the access token is fresh; check Sitecore Cloud status if the failure persists.",
  UNKNOWN: "Re-run with `SITECOREAI_TRACE=1` set in the launcher to capture a verbose trace.",
};

const summarizeError = (error: ScaiError): string => {
  switch (error.code) {
    case "AUTH_REQUIRED":
      return "Authentication required.";
    case "AUTH_DENIED":
      return "MCP write tools are not permitted for this environment.";
    case "POLICY_DENIED":
      return "The target environment is not allowed by the workspace policy.";
    case "CONFIG_NOT_FOUND":
      return "scai configuration was not found.";
    case "CONFIG_INVALID":
      return "scai configuration is invalid.";
    case "INPUT_INVALID":
      return "Tool input is invalid.";
    case "NETWORK":
      return "A network call to Sitecore Cloud failed.";
    case "ENV_NOT_FOUND":
      return "The requested environment is not configured.";
    case "DEPLOY_FAILED":
      return "The XM Cloud Deploy operation failed.";
    case "SITES_API_FAILED":
      return "The Sites API call failed.";
    case "BRIEF_API_FAILED":
      return "The Brief API call failed.";
    case "CANCELLED":
      return "The tool was cancelled mid-flight by the client.";
    case "UNKNOWN":
    default:
      return "The tool failed with an unexpected error.";
  }
};

export interface ToolErrorEnvelope {
  code: ScaiErrorCode;
  exitCode: number;
  what: string;
  why: string;
  hint?: string;
  next: string;
  /**
   * Machine-actionable remediation when the error carries one — lets the
   * agent route the failure (`actor`: act itself / hand to a human /
   * retry) without parsing the prose `next` line.
   */
  remediation?: Remediation;
  docsUri?: string;
}

export const toolResultFromError = (error: unknown): CallToolResult => {
  const scaiError = toScaiError(error);
  const what = summarizeError(scaiError);
  const why = redactString(scaiError.message);
  const hint = scaiError.hint ? redactString(scaiError.hint) : undefined;
  const next = NEXT_HINT_BY_CODE[scaiError.code] ?? NEXT_HINT_BY_CODE.UNKNOWN;
  const docsUri = DOCS_URI_BY_CODE[scaiError.code];
  const remediation: Remediation | undefined = scaiError.remediation
    ? {
        actor: scaiError.remediation.actor,
        fix: redactString(scaiError.remediation.fix),
        detail: scaiError.remediation.detail
          ? redactString(scaiError.remediation.detail)
          : undefined,
      }
    : undefined;

  // A structured remediation is more specific than the per-code `next`
  // hint — lead the "Next" line with it when present.
  const nextLine = remediation
    ? `${remediation.fix} [${remediation.actor}]${remediation.detail ? ` — ${remediation.detail}` : ""}`
    : next;

  const text = [
    `What happened: ${what}`,
    `Why: ${why}${hint ? ` (${hint})` : ""}`,
    `Next: ${nextLine}`,
  ].join("\n");

  const envelope: ToolErrorEnvelope = {
    code: scaiError.code,
    exitCode: scaiError.exitCode,
    what,
    why,
    hint,
    next,
    remediation,
    docsUri,
  };

  return {
    isError: true,
    content: [{ type: "text", text }],
    structuredContent: redactStructured(envelope) as Record<string, unknown>,
  };
};
