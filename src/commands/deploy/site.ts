/**
 * `scai deploy site` — read-only discovery of SXA sites in a CM
 * environment via the Authoring GraphQL API.
 *
 * Sibling of `deploy editing-host` (which talks to the Deploy API).
 * Uses the same env profile + auth as `scai recipe push`.
 */

import { Command, Option } from "commander";
import { runDeploySiteList } from "../../serialization/tasks";
import { addDeployBaseOptions } from "./shared";

export const createDeploySiteCommand = (): Command => {
  const site = new Command("site").description("SXA site operations").alias("sites");

  const list = new Command("list")
    .description("List SXA sites in a CM environment")
    .alias("ls");
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

  site.addCommand(list);
  return site;
};
