/**
 * `createSiteBinding` — the reusable, CLI-free core of `scai deploy site bind`.
 *
 * Populates the SXA Site Grouping fields the Cloud Portal Pages / Channels app
 * needs for a site to surface — `HostName`, `StartItem`, `RenderingHost`. SXA's
 * Create Site wizard sets these automatically; sites created via other paths
 * (custom provisioning, site-template clone) often leave them blank and the
 * Pages app silently filters them out.
 *
 * `RenderingHost` is a string-keyed lookup — Sitecore resolves the value (the
 * editing host name) against `/sitecore/system/Settings/Services/Rendering
 * Hosts/<name>` at request time, so the field can be written before the
 * rendering-host item exists.
 *
 * Takes an already-built Authoring client (host resolution differs by context —
 * CLI config vs a Deploy-API lookup), so this stays a pure bind shared by the
 * `scai deploy site bind` CLI (`./tasks/site-bind`) and SDK consumers
 * (`@sitecoreai-labs/sitecoreai-cli/deploy`). This module imports no CLI/logger
 * code, keeping the `./deploy` subpath export bundle-safe.
 */

import type { AuthoringApiClient } from "@/authoring";
import { createScaiError } from "@/shared/errors";

export type SiteBindingInput = {
  /** SXA site name (e.g. `e2e`). */
  siteName: string;
  /** SXA SiteCollection (Headless Tenant) the site lives under. */
  siteCollection: string;
  /** `RenderingHost` field value; defaults to `siteName` (the editing-host slug). */
  renderingHostName?: string;
  /** Start Item page name under the site root; defaults to `Home`. */
  startItemName?: string;
  /** `HostName` field pattern; defaults to `*` (matches any hostname). */
  hostNamePattern?: string;
};

export type SiteBindingStatus = "applied" | "no-op" | "plan";

export interface SiteBindingResult {
  siteGroupingPath: string;
  siteGroupingItemId: string;
  startItemPath: string;
  startItemId: string;
  applied: boolean;
  status: SiteBindingStatus;
  fields: {
    HostName: string;
    StartItem: string;
    RenderingHost: string;
  };
}

/**
 * Bind a site's SXA Site Grouping using an Authoring client bound to the CM env.
 *
 * - `apply: true` writes the fields, but is idempotent — skips the write when
 *   the three fields already carry the target values (`status: "no-op"`).
 * - `apply: false` (default) computes the plan — reads the items, never writes
 *   (`status: "plan"`).
 * - Throws `INPUT_INVALID` for blank input or a missing Site Grouping / Start
 *   Item.
 */
export const createSiteBinding = async (
  client: AuthoringApiClient,
  input: SiteBindingInput,
  options: { apply?: boolean } = {}
): Promise<SiteBindingResult> => {
  const apply = options.apply ?? false;
  const siteName = input.siteName?.trim();
  const siteCollection = input.siteCollection?.trim();
  if (!siteName) {
    throw createScaiError("Site name is required.", "INPUT_INVALID", {
      hint: "Pass a non-empty siteName (e.g. `e2e`).",
    });
  }
  if (!siteCollection) {
    throw createScaiError("Site collection is required.", "INPUT_INVALID", {
      hint: "Pass siteCollection (the Headless Tenant the site lives under).",
    });
  }
  const renderingHostName = input.renderingHostName?.trim() || siteName;
  const startItemName = input.startItemName?.trim() || "Home";
  const hostNamePattern = input.hostNamePattern?.trim() || "*";

  const siteRoot = `/sitecore/content/${siteCollection}/${siteName}`;
  const siteGroupingPath = `${siteRoot}/Settings/Site Grouping/${siteName}`;
  const startItemPath = `${siteRoot}/${startItemName}`;

  const siteGrouping = await client.getItem({ path: siteGroupingPath });
  if (!siteGrouping) {
    throw createScaiError(
      `Site Grouping item '${siteGroupingPath}' was not found.`,
      "INPUT_INVALID",
      {
        hint: "Verify siteName + siteCollection point at an existing SXA Headless Site. The Site Grouping item lives under the site's `Settings/Site Grouping/<siteName>` path.",
      }
    );
  }

  const fieldByName = (name: string): string =>
    siteGrouping.fields.find((f) => f.name === name)?.value?.trim() ?? "";
  const existingStartItem = fieldByName("StartItem");

  // Idempotency short-circuit (apply mode only): if the Site Grouping already
  // carries the three fields we'd write, skip the write so re-runs are cheap
  // and don't bump field version history.
  if (apply) {
    const existingRenderingHost = fieldByName("RenderingHost");
    const existingHostName = fieldByName("HostName");
    if (
      existingRenderingHost === renderingHostName &&
      existingHostName === hostNamePattern &&
      existingStartItem.length > 0
    ) {
      return {
        siteGroupingPath,
        siteGroupingItemId: siteGrouping.itemId,
        startItemPath,
        startItemId: existingStartItem.replace(/[{}]/g, ""),
        applied: false,
        status: "no-op",
        fields: {
          HostName: existingHostName,
          StartItem: existingStartItem,
          RenderingHost: existingRenderingHost,
        },
      };
    }
  }

  // Resolve the Start Item to write. An EXISTING site already carries a
  // StartItem (its own home) — PRESERVE it and only (re)point RenderingHost /
  // HostName. We deliberately do NOT require a `<siteRoot>/<startItemName>`
  // item to exist in that case: the site's home may be named differently or
  // live elsewhere, so requiring a literal "Home" here fails a perfectly valid
  // existing site (the `/sitecore/content/<collection>/<site>/Home not found`
  // bind failure). Only when the Site Grouping has NO StartItem yet do we fall
  // back to the conventional `<siteRoot>/<startItemName>` and require it.
  let startItemId: string;
  let startItemFieldValue: SiteBindingResult["fields"]["StartItem"];
  if (existingStartItem.length > 0) {
    startItemId = existingStartItem.replace(/[{}]/g, "");
    startItemFieldValue = existingStartItem;
  } else {
    const startItem = await client.getItem({ path: startItemPath });
    if (!startItem) {
      throw createScaiError(`Start item '${startItemPath}' was not found.`, "INPUT_INVALID", {
        hint: `Create a '${startItemName}' page under ${siteRoot} (or pass a different startItemName). Without a Start Item the site won't render.`,
      });
    }
    startItemId = startItem.itemId;
    startItemFieldValue = `{${startItem.itemId.toUpperCase()}}`;
  }

  const plannedFields = {
    HostName: hostNamePattern,
    StartItem: startItemFieldValue,
    RenderingHost: renderingHostName,
  };

  if (!apply) {
    return {
      siteGroupingPath,
      siteGroupingItemId: siteGrouping.itemId,
      startItemPath,
      startItemId,
      applied: false,
      status: "plan",
      fields: plannedFields,
    };
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
        value: { kind: "ref-guid", value: startItemId },
      },
      {
        // SXA's RenderingHost field is a string-keyed lookup, not a GUID
        // reference. Sitecore resolves the value (e.g. `"e2e"`) against
        // `/sitecore/system/Settings/Services/Rendering Hosts/<name>` at
        // request time, so it's safe to set before the rendering-host item
        // exists. Verified via Authoring API introspection 2026-05-02.
        fieldId: "",
        fieldName: "RenderingHost",
        value: { kind: "string", value: renderingHostName },
      },
    ],
  });

  return {
    siteGroupingPath,
    siteGroupingItemId: siteGrouping.itemId,
    startItemPath,
    startItemId,
    applied: true,
    status: "applied",
    fields: plannedFields,
  };
};
