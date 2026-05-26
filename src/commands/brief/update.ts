import fs from "node:fs";
import { Command, Option } from "commander";
import { runBriefUpdate } from "@/brief/tasks";
import type { CreateBriefInput } from "@/brief";
import type { BriefStatus } from "@/brief";
import { inputError } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import {
  addApplyOption,
  addConfigOption,
  addOrgScopeOptions,
  addVerbosityOptions,
  addWhatIfOption,
  withApplyGate,
} from "../shared";

/**
 * `scai ops brief update <briefId>` — partial-PUT update of a brief
 * instance. The JSON body is `Partial<CreateBriefInput> & { status? }`:
 * any subset of `name`, `locale`, `fields`, `isTemplate`, plus an
 * optional `status` workflow move. Read first if you only want to
 * change one field — the PUT is partial but applies whatever keys it
 * receives.
 *
 * Use `scai ops brief set-status` for status-only moves (already wired)
 * or this command's `--status <s>` flag as a shortcut that bypasses the
 * `--file` requirement.
 */
const KNOWN_STATUSES: ReadonlyArray<BriefStatus> = [
  "Draft",
  "InReview",
  "Approved",
  "Canceled",
  "Archived",
];

const readJsonFile = (path: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    throw inputError(
      `Could not read JSON from ${path}: ${error instanceof Error ? error.message : String(error)}`,
      "Pass --file <path> pointing at a valid brief-update JSON document."
    );
  }
};

const assertUpdateBody = (value: unknown): Partial<CreateBriefInput> & { status?: BriefStatus } => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createScaiError("Brief update body must be a JSON object.", "INPUT_INVALID");
  }
  const obj = value as Record<string, unknown>;
  if (obj.status !== undefined && !KNOWN_STATUSES.includes(obj.status as BriefStatus)) {
    throw createScaiError(`Invalid 'status': ${JSON.stringify(obj.status)}.`, "INPUT_INVALID", {
      hint: `Must be one of: ${KNOWN_STATUSES.join(", ")}.`,
    });
  }
  if (obj.fields !== undefined && (typeof obj.fields !== "object" || Array.isArray(obj.fields))) {
    throw createScaiError("'fields' must be an object keyed by field name.", "INPUT_INVALID");
  }
  return obj as Partial<CreateBriefInput> & { status?: BriefStatus };
};

export const createBriefUpdateCommand = (): Command => {
  const command = new Command("update")
    .description(
      "Update a brief instance with a partial-PUT body. Provide --file for arbitrary patches, or --status as a shortcut for a status-only move."
    )
    .argument("<briefId>", "Brief UUID")
    .addOption(new Option("-f, --file <path>", "Path to a JSON file with the partial patch."))
    .addOption(
      new Option(
        "--status <status>",
        "Shortcut: status-only patch. Equivalent to `scai ops brief set-status`."
      ).choices(KNOWN_STATUSES as unknown as string[])
    );
  addOrgScopeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  addApplyOption(command);
  addWhatIfOption(command);
  command.action(async (briefId, options) => {
    await withApplyGate(
      async (opts: { file?: string; status?: BriefStatus; apply?: boolean; whatIf?: boolean }) => {
        if (!opts.file && !opts.status) {
          throw inputError(
            "Pass --file <path> or --status <status>.",
            "The PUT requires at least one field; pass a JSON file with the patch or use --status for the common case."
          );
        }
        const fromFile = opts.file ? assertUpdateBody(readJsonFile(opts.file)) : {};
        const patch: Partial<CreateBriefInput> & { status?: BriefStatus } = {
          ...fromFile,
          ...(opts.status ? { status: opts.status } : {}),
        };
        await runBriefUpdate({ ...opts, briefId, patch });
      }
    )(options);
  });
  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai ops brief update <id> --status Approved -n agents --apply\n" +
      "  $ scai ops brief update <id> -f ./patch.json -n agents --apply\n"
  );
  return command;
};
