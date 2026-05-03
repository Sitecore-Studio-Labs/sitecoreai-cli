/**
 * `scai deploy site` — read-only discovery of SXA sites in a CM
 * environment via the Authoring GraphQL API.
 *
 * Sibling of `deploy editing-host` (which talks to the Deploy API).
 * Uses the same env profile + auth as `scai recipe push`.
 */

import { Command, Option } from "commander";
import { runDeploySiteBind, runDeploySiteList } from "@/deploy/tasks";
import { addDeployBaseOptions } from "./shared";

export const createDeploySiteCommand = (): Command => {
  const site = new Command("site").description("SXA site operations").alias("sites");

  const list = new Command("list").description("List SXA sites in a CM environment").alias("ls");
  addDeployBaseOptions(list);
  list
    .addOption(
      new Option(
        "--hostnames",
        "Resolve declared hostnames per site (adds an N+1 round trip per site)"
      )
    )
    .addOption(
      new Option(
        "--content-root <path>",
        "Override the content root walked. Default `/sitecore/content`."
      )
    );
  list.action(async (options) => runDeploySiteList(options));

  const bind = new Command("bind").description(
    "Populate Site Grouping fields (HostName / TargetHostName / StartItem / RenderingHost) so the site appears in Pages / Channels"
  );
  addDeployBaseOptions(bind);
  bind
    .addOption(new Option("--site-name <name>", "SXA site name (e.g. `e2e`)"))
    .addOption(
      new Option(
        "--site-collection <name>",
        "SXA SiteCollection (Headless Tenant) the site lives under"
      )
    )
    .addOption(
      new Option(
        "--rendering-host-name <name>",
        "Override the RenderingHost item name. Default: --site-name."
      )
    )
    .addOption(
      new Option(
        "--start-item-name <name>",
        "Start item name (relative to the site root). Default `Home`."
      )
    )
    .addOption(
      new Option("--host-name-pattern <value>", "HostName field value. Default `*` (wildcard).")
    )
    .addOption(
      new Option(
        "--wait-for-rendering-host-seconds <seconds>",
        "Max seconds to wait for the RenderingHost item to be auto-created. Default 180."
      ).argParser(Number)
    )
    .addOption(
      new Option("--allow-write", "Apply changes (without it, the command runs in plan-only mode)")
    );
  bind.action(async (options) => runDeploySiteBind(options));

  site.addCommand(bind);
  site.addCommand(list);
  return site;
};
