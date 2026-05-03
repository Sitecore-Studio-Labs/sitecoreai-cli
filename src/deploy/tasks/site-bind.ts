/**
 * `scai deploy site bind` runner.
 *
 * Populates the SXA Site Grouping fields the Cloud Portal Pages /
 * Channels app requires for a site to surface — `HostName`,
 * `TargetHostName`, `StartItem`, `RenderingHost`. SXA's Create Site
 * wizard sets these automatically; sites created via other paths
 * (custom provisioning, site-template clone) often leave them blank
 * and the Pages app silently filters them out.
 *
 * Source-of-truth for the URL fields is the matching `RenderingHost`
 * item under `/sitecore/system/Settings/Services/Rendering Hosts/<name>`
 * — auto-created by the Cloud Portal post-deploy step after the
 * editing host deploys. That step is async, so this command polls
 * for the item up to `waitForRenderingHostSeconds` (default 180)
 * before patching.
 */

import { createAuthoringClient } from "@/recipe/api/authoring-client";
import { createCliError } from "@/shared/errors";
import { resolveEnvironment } from "@/shared/env";
import { printDeployResultWithContext, toLogger } from "./shared";
import type { DeploySiteBindOptions } from "./types";

const DEFAULT_WAIT_SECONDS = 180;
const POLL_INTERVAL_MS = 5_000;

const stripProtocol = (url: string): string => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

interface BindResult {
  envName: string;
  siteGroupingPath: string;
  siteGroupingItemId: string;
  renderingHostPath: string;
  renderingHostItemId: string;
  startItemPath: string;
  startItemId: string;
  applied: boolean;
  fields: {
    HostName: string;
    TargetHostName: string;
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
  const waitSeconds = options.waitForRenderingHostSeconds ?? DEFAULT_WAIT_SECONDS;

  const { envName, environment, timeoutMs } = resolveEnvironment(options);
  const client = createAuthoringClient({
    environment,
    request: timeoutMs ? { timeoutMs } : undefined,
  });

  const siteRoot = `/sitecore/content/${options.siteCollection}/${options.siteName}`;
  const siteGroupingPath = `${siteRoot}/Settings/Site Grouping/${options.siteName}`;
  const renderingHostPath = `/sitecore/system/Settings/Services/Rendering Hosts/${renderingHostName}`;
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

  const startItem = await client.getItem({ path: startItemPath });
  if (!startItem) {
    throw createCliError(`Start item '${startItemPath}' was not found.`, "INPUT_INVALID", {
      hint: `Create a '${startItemName}' page under ${siteRoot} (or pass --start-item-name to point at the page that already exists). Without a Start Item the site won't render.`,
    });
  }

  // Poll for the RenderingHost item — the Cloud Portal post-deploy
  // step that creates it runs async, so it can lag behind the deploy
  // status report by tens of seconds to a few minutes.
  const renderingHost = await waitForRenderingHost(
    client,
    renderingHostPath,
    waitSeconds * 1000,
    (msg) => logger.info(msg, "cyan")
  );

  // Pull TargetHostName off the RenderingHost item — its
  // ServerSideRenderingEngineApplicationUrl carries the
  // `https://xmc-...-eh.sitecorecloud.io` URL the Cloud Portal
  // wired up. Strip the protocol so the Site Grouping field gets
  // a bare hostname (matches the SXA convention).
  const remoteFull = await client.getItem({ itemId: renderingHost.itemId });
  const appUrlField = remoteFull?.fields.find(
    (f) => f.name === "ServerSideRenderingEngineApplicationUrl"
  );
  if (!appUrlField?.value) {
    throw createCliError(
      `RenderingHost '${renderingHostPath}' has no ServerSideRenderingEngineApplicationUrl.`,
      "INPUT_INVALID",
      {
        hint: "The Cloud Portal post-deploy step that populates this field hasn't run yet (or failed). Re-run after a successful editing-host deploy.",
      }
    );
  }
  const targetHostName = stripProtocol(appUrlField.value.trim());

  const result: BindResult = {
    envName,
    siteGroupingPath,
    siteGroupingItemId: siteGrouping.itemId,
    renderingHostPath,
    renderingHostItemId: renderingHost.itemId,
    startItemPath,
    startItemId: startItem.itemId,
    applied: false,
    fields: {
      HostName: hostNamePattern,
      TargetHostName: targetHostName,
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
        fieldName: "TargetHostName",
        value: { kind: "string", value: targetHostName },
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
        // at request time. Verified via Authoring API introspection
        // 2026-05-02 — `RenderingHost` field on a working e2e Site
        // Grouping carried the bare name `"e2e"`, not `{GUID}`.
        fieldId: "",
        fieldName: "RenderingHost",
        value: { kind: "string", value: renderingHostName },
      },
    ],
  });

  result.applied = true;
  printDeployResultWithContext(logger, { envName }, "deploy.site.bind", result);
};

interface PollableItem {
  itemId: string;
}

const waitForRenderingHost = async (
  client: ReturnType<typeof createAuthoringClient>,
  path: string,
  timeoutMs: number,
  log: (msg: string) => void
): Promise<PollableItem> => {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let attempt = 0;
  while (true) {
    attempt += 1;
    const remote = await client.getItem({ path });
    if (remote) return { itemId: remote.itemId };
    if (Date.now() >= deadline) {
      throw createCliError(
        `RenderingHost item '${path}' was not found within ${Math.round(timeoutMs / 1000)}s.`,
        "INPUT_INVALID",
        {
          hint: "The Cloud Portal post-deploy step that auto-creates RenderingHost items runs after the deploy succeeds. Either wait longer (raise --wait-for-rendering-host-seconds), confirm the deploy actually completed, or check the editing host name matches the `renderingHosts.<name>` entry in xmcloud.build.json.",
        }
      );
    }
    if (attempt === 1 || attempt % 6 === 0) {
      log(
        `Waiting for RenderingHost item at ${path} (poll #${attempt}, ${Math.round((deadline - Date.now()) / 1000)}s remaining)...`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
};
