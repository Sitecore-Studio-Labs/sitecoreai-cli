import { Command, Option } from "commander";
import {
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
} from "../shared";
import { runDeployEnvFile } from "@/deploy/tasks/env-file";

/**
 * `scai provision deploy env-file` — generate/update `.env.local` for a Content
 * SDK head app, looking up the Edge preview/live context ids (environment GET)
 * + editing secret from the Deploy API (no hand-pasting secrets). Merges into an
 * existing file.
 */
export const createDeployEnvFileCommand = (): Command => {
  const command = new Command("env-file").description(
    "Write/update .env.local for a Content SDK head app — looks up the Edge context id + editing secret from the environment (Deploy API) and merges them in."
  );

  addEnvironmentOption(command);
  command
    .addOption(
      new Option(
        "--site <name>",
        "Site for NEXT_PUBLIC_DEFAULT_SITE_NAME (defaults to the profile's site)."
      )
    )
    .addOption(
      new Option("--language <lang>", "Default language for NEXT_PUBLIC_DEFAULT_LANGUAGE.").default(
        "en"
      )
    )
    .addOption(new Option("-o, --output <path>", "Path to write. Defaults to ./.env.local."));
  addWhatIfOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.addHelpText(
    "after",
    [
      "",
      "Resolves from the Deploy API and writes (merging, not clobbering):",
      "  SITECORE_EDGE_CONTEXT_ID / NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID  (env GET previewContextId)",
      "  SITECORE_EDGE_LIVE_CONTEXT_ID                                    (env GET liveContextId)",
      "  SITECORE_EDITING_SECRET                                          (obtain-editing-secret)",
      "  NEXT_PUBLIC_DEFAULT_SITE_NAME / NEXT_PUBLIC_DEFAULT_LANGUAGE",
      "",
      "Examples:",
      "  $ scai provision deploy env-file -n Sodra",
      "  $ scai provision deploy env-file -n Sodra --what-if   # preview (secrets masked)",
      "",
    ].join("\n")
  );

  command.action(async (options) => {
    await runDeployEnvFile(options);
  });
  return command;
};
