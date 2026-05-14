import { Command } from "commander";
import { runAuditSiteResidue } from "@/hygiene/tasks";
import { addAuditBaseOptions } from "./shared";

export const createAuditSiteResidueCommand = (): Command => {
  const command = new Command("site-residue").description(
    "Find SXA tenant/site folders left behind after a Sites-API delete (templates/Project, layout/Renderings/Project, media library/Project)"
  );

  const list = new Command("list").description("List orphan site/tenant subtrees");
  addAuditBaseOptions(list);
  list.option(
    "--root <path>",
    "Additional root to scan on top of the SXA defaults. Repeat or comma-separate.",
    (value: string, previous: string[] = []) =>
      previous.concat(
        value
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      ),
    []
  );
  list.option(
    "--content-root <path>",
    "Override the content root walked when discovering active sites (default /sitecore/content)"
  );
  list.action(async (options) => {
    await runAuditSiteResidue(options);
  });

  command.addCommand(list);
  return command;
};
