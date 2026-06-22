/**
 * `scai provision deploy site bind` runner — the CLI wrapper around
 * `createSiteBinding` (the reusable, CLI-free core in `../site-binding`, also
 * exported from `@sitecoreai-labs/sitecoreai-cli/deploy` for SDK consumers).
 *
 * Resolves the environment + builds an Authoring client, runs the bind, and
 * prints the result. The bind logic (SXA Site Grouping fields, idempotency,
 * the RenderingHost string-key semantics) lives in `../site-binding`.
 */

import { createAuthoringClient } from "@/authoring";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/policy/environment";
import { createSiteBinding } from "../site-binding";
import { printDeployResultWithContext, toLogger } from "./shared";
import type { DeploySiteBindOptions } from "./types";

export const runDeploySiteBind = async (options: DeploySiteBindOptions): Promise<void> => {
  const logger = toLogger(options);
  // Validate CLI inputs early (before resolving the environment) so a missing
  // flag fails fast with a flag-shaped hint. `createSiteBinding` re-validates
  // defensively for direct SDK callers.
  if (!options.siteName) {
    throw createScaiError("Site name is required.", "INPUT_INVALID", {
      hint: "Pass --site-name (e.g. `e2e`).",
    });
  }
  if (!options.siteCollection) {
    throw createScaiError("Site collection is required.", "INPUT_INVALID", {
      hint: "Pass --site-collection (the Headless Tenant the site lives under).",
    });
  }
  const { envName, environment, timeoutMs } = resolveEnvironment(options);
  const client = createAuthoringClient({
    environment,
    request: timeoutMs ? { timeoutMs } : undefined,
  });

  const apply = !options.whatIf && Boolean(options.allowWrite);
  const { status, ...rest } = await createSiteBinding(
    client,
    {
      siteName: options.siteName,
      siteCollection: options.siteCollection,
      renderingHostName: options.renderingHostName,
      startItemName: options.startItemName,
      hostNamePattern: options.hostNamePattern,
    },
    { apply }
  );

  if (status === "no-op") {
    logger.info(
      `Site Grouping at ${rest.siteGroupingPath} already bound to RenderingHost='${rest.fields.RenderingHost}'. No changes.`,
      "green"
    );
    printDeployResultWithContext(logger, { envName }, "deploy.site.bind", {
      envName,
      ...rest,
      mode: "no-op (already bound)",
    });
    return;
  }

  if (status === "plan") {
    printDeployResultWithContext(logger, { envName }, "deploy.site.bind", {
      envName,
      ...rest,
      mode: options.whatIf ? "what-if" : "plan-only (--allow-write not set)",
    });
    return;
  }

  printDeployResultWithContext(logger, { envName }, "deploy.site.bind", {
    envName,
    ...rest,
  });
};
