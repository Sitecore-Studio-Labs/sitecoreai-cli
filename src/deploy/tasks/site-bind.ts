/**
 * `scai deploy site bind` runner.
 *
 * Populates the SXA Site Grouping fields the Cloud Portal Pages /
 * Channels app requires for a site to surface — `HostName`,
 * `StartItem`, `RenderingHost`. SXA's Create Site wizard sets these
 * automatically; sites created via other paths (custom provisioning,
 * site-template clone) often leave them blank and the Pages app
 * silently filters them out.
 *
 * `RenderingHost` is a string-keyed lookup — Sitecore resolves the
 * value (the editing host name) against
 * `/sitecore/system/Settings/Services/Rendering Hosts/<name>` at
 * request time. Writing the field doesn't require the rendering-host
 * item to exist yet, so the bind has no dependency on the editing
 * host deploy and can run any time after the Site Grouping itself
 * has been provisioned.
 */

import { createAuthoringClient } from "@/recipe/api/authoring-client";
import { createCliError } from "@/shared/errors";
import { resolveEnvironment } from "@/shared/env";
import { printDeployResultWithContext, toLogger } from "./shared";
import type { DeploySiteBindOptions } from "./types";

interface BindResult {
  envName: string;
  siteGroupingPath: string;
  siteGroupingItemId: string;
  startItemPath: string;
  startItemId: string;
  applied: boolean;
  fields: {
    HostName: string;
    StartItem: string;
    RenderingHost: string;
  };
}

export const runDeploySiteBind = async (options: DeploySiteBindOptions): Promise<void> => {
  const logger = toLogger(options);
  if (!options.siteName) {
    throw createCliError("Site name is required.", "INPUT_INVALID", {
      hint: "Pass --site-name (e.g. `e2e`).",
    });
  }
  if (!options.siteCollection) {
    throw createCliError("Site collection is required.", "INPUT_INVALID", {
      hint: "Pass --site-collection (the Headless Tenant the site lives under).",
    });
  }
  const renderingHostName = options.renderingHostName ?? options.siteName;
  const startItemName = options.startItemName ?? "Home";
  const hostNamePattern = options.hostNamePattern ?? "*";

  const { envName, environment, timeoutMs } = resolveEnvironment(options);
  const client = createAuthoringClient({
    environment,
    request: timeoutMs ? { timeoutMs } : undefined,
  });

  const siteRoot = `/sitecore/content/${options.siteCollection}/${options.siteName}`;
  const siteGroupingPath = `${siteRoot}/Settings/Site Grouping/${options.siteName}`;
  const startItemPath = `${siteRoot}/${startItemName}`;

  const siteGrouping = await client.getItem({ path: siteGroupingPath });
  if (!siteGrouping) {
    throw createCliError(
      `Site Grouping item '${siteGroupingPath}' was not found.`,
      "INPUT_INVALID",
      {
        hint: "Verify --site-name and --site-collection point at an existing SXA Headless Site. The Site Grouping item lives under the site's `Settings/Site Grouping/<siteName>` path.",
      }
    );
  }

  // Idempotency short-circuit: if the Site Grouping already carries
  // the three fields we'd write, skip the write entirely so re-runs
  // are cheap and don't bump field version history.
  if (!options.whatIf && options.allowWrite) {
    const fieldByName = (name: string): string =>
      siteGrouping.fields.find((f) => f.name === name)?.value?.trim() ?? "";
    const existingRenderingHost = fieldByName("RenderingHost");
    const existingHostName = fieldByName("HostName");
    const existingStartItem = fieldByName("StartItem");
    const alreadyBound =
      existingRenderingHost === renderingHostName &&
      existingHostName === hostNamePattern &&
      existingStartItem.length > 0;
    if (alreadyBound) {
      logger.info(
        `Site Grouping at ${siteGroupingPath} already bound to RenderingHost='${renderingHostName}'. No changes.`,
        "green"
      );
      printDeployResultWithContext(logger, { envName }, "deploy.site.bind", {
        envName,
        siteGroupingPath,
        siteGroupingItemId: siteGrouping.itemId,
        startItemPath,
        startItemId: existingStartItem.replace(/[{}]/g, ""),
        applied: false,
        fields: {
          HostName: existingHostName,
          StartItem: existingStartItem,
          RenderingHost: existingRenderingHost,
        },
        mode: "no-op (already bound)",
      } as BindResult & { mode: string });
      return;
    }
  }

  const startItem = await client.getItem({ path: startItemPath });
  if (!startItem) {
    throw createCliError(`Start item '${startItemPath}' was not found.`, "INPUT_INVALID", {
      hint: `Create a '${startItemName}' page under ${siteRoot} (or pass --start-item-name to point at the page that already exists). Without a Start Item the site won't render.`,
    });
  }

  const result: BindResult = {
    envName,
    siteGroupingPath,
    siteGroupingItemId: siteGrouping.itemId,
    startItemPath,
    startItemId: startItem.itemId,
    applied: false,
    fields: {
      HostName: hostNamePattern,
      StartItem: `{${startItem.itemId.toUpperCase()}}`,
      RenderingHost: renderingHostName,
    },
  };

  if (options.whatIf || !options.allowWrite) {
    printDeployResultWithContext(logger, { envName }, "deploy.site.bind", {
      ...result,
      mode: options.whatIf ? "what-if" : "plan-only (--allow-write not set)",
    });
    return;
  }

  await client.updateItem({
    itemId: siteGrouping.itemId,
    fields: [
      {
        fieldId: "",
        fieldName: "HostName",
        value: { kind: "string", value: hostNamePattern },
      },
      {
        fieldId: "",
        fieldName: "StartItem",
        value: { kind: "ref-guid", value: startItem.itemId },
      },
      {
        // SXA's RenderingHost field is a string-keyed lookup, not a
        // GUID reference. Sitecore resolves the value (e.g. `"e2e"`)
        // against `/sitecore/system/Settings/Services/Rendering Hosts/<name>`
        // at request time, so it's safe to set before the
        // rendering-host item exists. Verified via Authoring API
        // introspection 2026-05-02 — `RenderingHost` field on a
        // working e2e Site Grouping carried the bare name `"e2e"`,
        // not `{GUID}`.
        fieldId: "",
        fieldName: "RenderingHost",
        value: { kind: "string", value: renderingHostName },
      },
    ],
  });

  result.applied = true;
  printDeployResultWithContext(logger, { envName }, "deploy.site.bind", result);
};
