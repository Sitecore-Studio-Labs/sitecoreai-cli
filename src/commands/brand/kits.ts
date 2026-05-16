import fs from "node:fs";
import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";
import { readRootConfiguration } from "@/config/root-config";
import {
  createBrandKit,
  deleteBrandKit,
  getBrandKit,
  listBrandKits,
  listBrandKitFields,
  listBrandKitSections,
  publishBrandKit,
  updateBrandKitField,
  type BrandApiClientOptions,
  type BrandKitFieldValue,
} from "@/brand";
import { confirmDestructive, inputError, toLogger } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import type { CommonOptions } from "@/shared/cli-options";

interface KitsCommonOptions extends CommonOptions {
  environmentName?: string;
  orgId?: string;
  format?: "text" | "json";
}

const resolveClient = (
  options: KitsCommonOptions
): { client: BrandApiClientOptions; orgId: string } => {
  const root = readRootConfiguration(options.config ?? process.cwd(), options.environmentName);
  const envName = options.environmentName ?? root.defaultEnvironment;
  const env = root.environments[envName];
  const orgId = options.orgId ?? env?.organizationId;
  if (!orgId) {
    throw inputError(
      `Cannot resolve organizationId for env '${envName}'.`,
      "Pass --org-id <id> or set organizationId on the env profile."
    );
  }
  const credential = root.brand?.[orgId];
  if (!credential) {
    throw createScaiError(
      `No Brand credential is configured for org '${orgId}'.`,
      "AUTH_BRAND_REQUIRED",
      { hint: `Run \`scai setup login brand -n ${envName}\` to provision one.` }
    );
  }
  return { client: { orgId, credential }, orgId };
};

const writeJson = (value: unknown): void => {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
};

const createListKitsCommand = (): Command => {
  const command = new Command("list")
    .description("List brand kits in the active organization.")
    .addOption(new Option("--page-number <n>", "1-based page number"))
    .addOption(new Option("--page-size <n>", "Items per page"))
    .addOption(
      new Option("--format <kind>", "Output format").choices(["text", "json"]).default("text")
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--org-id <id>", "Override orgId from env profile"));
  command.action(
    async (options: KitsCommonOptions & { pageNumber?: string; pageSize?: string }) => {
      const logger = toLogger(options);
      const { client } = resolveClient(options);
      const response = await listBrandKits({
        client,
        pageNumber: options.pageNumber ? Number(options.pageNumber) : undefined,
        pageSize: options.pageSize ? Number(options.pageSize) : undefined,
      });
      if (options.format === "json") {
        writeJson(response);
        return;
      }
      logger.info(
        `${response.totalCount} kit(s) (page ${response.pageNumber ?? 1}, size ${response.pageSize ?? response.data.length})`
      );
      for (const kit of response.data) {
        logger.info(
          `  ${kit.id}  ${kit.name ?? "(unnamed)"}  [${kit.status ?? "?"}]${kit.industry ? `  ${kit.industry}` : ""}`
        );
      }
    }
  );
  return command;
};

const createGetKitCommand = (): Command => {
  const command = new Command("get")
    .description("Retrieve a single brand kit by ID.")
    .argument("<kitId>", "Brand kit UUID")
    .addOption(
      new Option("--format <kind>", "Output format").choices(["text", "json"]).default("text")
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--org-id <id>", "Override orgId from env profile"));
  command.action(async (kitId: string, options: KitsCommonOptions) => {
    const logger = toLogger(options);
    const { client } = resolveClient(options);
    const kit = await getBrandKit({ client, brandKitId: kitId });
    if (options.format === "json") {
      writeJson(kit);
      return;
    }
    logger.info(`${kit.name ?? "(unnamed)"} — ${kit.id}`);
    logger.info(`  status:      ${kit.status ?? "?"}`);
    if (kit.industry) logger.info(`  industry:    ${kit.industry}`);
    if (kit.brandName && kit.brandName !== kit.name) logger.info(`  brand name:  ${kit.brandName}`);
    if (kit.description) logger.info(`  description: ${kit.description}`);
    if (kit.createdOn) logger.info(`  created:     ${kit.createdOn}`);
    if (kit.updatedOn) logger.info(`  updated:     ${kit.updatedOn}`);
  });
  return command;
};

const createSectionsCommand = (): Command => {
  const command = new Command("sections")
    .description("List section names + IDs of a brand kit.")
    .argument("<kitId>", "Brand kit UUID")
    .addOption(
      new Option("--format <kind>", "Output format").choices(["text", "json"]).default("text")
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--org-id <id>", "Override orgId from env profile"));
  command.action(async (kitId: string, options: KitsCommonOptions) => {
    const logger = toLogger(options);
    const { client } = resolveClient(options);
    const sections = await listBrandKitSections({ client, brandKitId: kitId });
    if (options.format === "json") {
      writeJson(sections);
      return;
    }
    if (sections.length === 0) {
      logger.info(
        `No sections yet — kit needs BrandIngestion + EnrichSections pipelines to populate.`
      );
      return;
    }
    logger.info(`${sections.length} section(s):`);
    const nameW = Math.max(...sections.map((s) => (s.name ?? "").length));
    for (const s of sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      const order = s.order !== undefined ? `${s.order}.` : " ";
      logger.info(`  ${order.padStart(3)} ${(s.name ?? "(unnamed)").padEnd(nameW)}  ${s.id}`);
    }
  });
  return command;
};

const createFieldsCommand = (): Command => {
  const command = new Command("fields")
    .description("List subsections (fields) within a section.")
    .argument("<kitId>", "Brand kit UUID")
    .argument("<sectionId>", "Section UUID")
    .addOption(
      new Option("--format <kind>", "Output format").choices(["text", "json"]).default("text")
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--org-id <id>", "Override orgId from env profile"));
  command.action(async (kitId: string, sectionId: string, options: KitsCommonOptions) => {
    const logger = toLogger(options);
    const { client } = resolveClient(options);
    const fields = await listBrandKitFields({
      client,
      brandKitId: kitId,
      sectionId,
    });
    if (options.format === "json") {
      writeJson(fields);
      return;
    }
    if (fields.length === 0) {
      logger.info("No fields in this section.");
      return;
    }
    logger.info(`${fields.length} field(s):`);
    for (const f of fields.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      const order = f.order !== undefined ? `${f.order}.` : " ";
      const ai = f.aiEditable ? "ai" : "  ";
      logger.info(`  ${order.padStart(3)} ${ai} ${f.name ?? "(unnamed)"}  ${f.id}`);
      if (f.intent) {
        logger.info(`       intent: ${f.intent}`);
      }
      if (f.value !== undefined && f.value !== "") {
        const preview =
          typeof f.value === "string"
            ? f.value.length > 200
              ? `${f.value.slice(0, 200)}…`
              : f.value
            : Array.isArray(f.value)
              ? f.value.length === 0
                ? "(empty array)"
                : `(${f.value.length} entries) ${f.value
                    .slice(0, 3)
                    .map((e) => e.name)
                    .join(" · ")}${f.value.length > 3 ? " · …" : ""}`
              : "(non-string value)";
        logger.info(`       value:  ${preview}`);
      }
    }
  });
  return command;
};

const createCreateKitCommand = (): Command => {
  const command = new Command("create")
    .description("Create a new brand kit. Lands in draft until published.")
    .argument("<name>", "Display name for the kit")
    .addOption(new Option("--description <text>", "Human description"))
    .addOption(new Option("--industry <label>", "Industry label"))
    .addOption(new Option("--brand-name <name>", "Brand name (defaults to display name)"))
    .addOption(new Option("--company-name <name>", "Company name (if different)"))
    .addOption(new Option("--logo <url>", "PNG logo URL"))
    .addOption(
      new Option("--format <kind>", "Output format").choices(["text", "json"]).default("text")
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--org-id <id>", "Override orgId from env profile"));
  command.action(
    async (
      name: string,
      options: KitsCommonOptions & {
        description?: string;
        industry?: string;
        brandName?: string;
        companyName?: string;
        logo?: string;
      }
    ) => {
      const logger = toLogger(options);
      const { client } = resolveClient(options);
      const kit = await createBrandKit({
        client,
        name,
        description: options.description,
        industry: options.industry,
        brandName: options.brandName,
        companyName: options.companyName,
        logo: options.logo,
      });
      if (options.format === "json") {
        writeJson(kit);
        return;
      }
      logger.info(`Created kit ${kit.id}`, "green");
      logger.info(`  status:   ${kit.status ?? "?"}`);
      logger.info(`  name:     ${kit.name}`);
      if (kit.industry) logger.info(`  industry: ${kit.industry}`);
      logger.info(
        `\nNext: publish + ingest with \`scai brand seed\` or run the individual steps manually.`
      );
    }
  );
  return command;
};

const createPublishKitCommand = (): Command => {
  const command = new Command("publish")
    .description("Mark a brand kit as published. Required before pipelines populate sections.")
    .argument("<kitId>", "Brand kit UUID")
    .addOption(
      new Option("--format <kind>", "Output format").choices(["text", "json"]).default("text")
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--org-id <id>", "Override orgId from env profile"));
  command.action(async (kitId: string, options: KitsCommonOptions) => {
    const logger = toLogger(options);
    const { client } = resolveClient(options);
    const kit = await publishBrandKit({ client, brandKitId: kitId });
    if (options.format === "json") {
      writeJson(kit);
      return;
    }
    logger.info(`Kit ${kit.id} is now ${kit.status}.`, "green");
  });
  return command;
};

const createDeleteKitCommand = (): Command => {
  const command = new Command("delete")
    .description("Delete a brand kit. Destructive — requires --force or interactive confirmation.")
    .argument("<kitId>", "Brand kit UUID")
    .addOption(new Option("-f, --force", "Skip the confirmation prompt"));
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--org-id <id>", "Override orgId from env profile"));
  command.action(async (kitId: string, options: KitsCommonOptions & { force?: boolean }) => {
    const logger = toLogger(options);
    const { client } = resolveClient(options);
    // Show what we're about to delete.
    const kit = await getBrandKit({ client, brandKitId: kitId });
    logger.info(`About to delete: ${kit.name} (${kit.id}) [${kit.status}]`);
    const proceed = await confirmDestructive(
      `Delete brand kit '${kit.name}' (${kit.id})?`,
      options.force
    );
    if (!proceed) {
      logger.info("Aborted.");
      return;
    }
    await deleteBrandKit({ client, brandKitId: kitId });
    logger.info(`Deleted kit ${kitId}.`, "green");
  });
  return command;
};

/**
 * Parse a `value` argument for `set-field`. The CLI accepts three
 * forms, in order of precedence:
 *   1. `--value-file <path>` — read raw text from disk (best for
 *      multi-line content; the file is treated as a UTF-8 string).
 *   2. `--value-json <json>` — parsed as JSON. Right shape for
 *      `array` and `richArray` fields (passing a JSON array).
 *   3. `--value <text>` — inline string (best for short `text` fields).
 *
 * Exactly one must be set; passing zero or multiple is a user error.
 */
const parseFieldValueArg = (options: {
  value?: string;
  valueJson?: string;
  valueFile?: string;
}): BrandKitFieldValue => {
  const provided = [
    options.value !== undefined ? "--value" : null,
    options.valueJson !== undefined ? "--value-json" : null,
    options.valueFile !== undefined ? "--value-file" : null,
  ].filter((x): x is string => x !== null);
  if (provided.length === 0) {
    throw inputError(
      "No field value supplied.",
      "Pass --value <text> for text fields, --value-json '<json>' for array/richArray fields, or --value-file <path>."
    );
  }
  if (provided.length > 1) {
    throw inputError(
      `Multiple value sources passed: ${provided.join(", ")}.`,
      "Pick one of --value, --value-json, --value-file."
    );
  }
  if (options.valueFile !== undefined) {
    if (!fs.existsSync(options.valueFile)) {
      throw inputError(`Value file not found: ${options.valueFile}.`);
    }
    return fs.readFileSync(options.valueFile, "utf8");
  }
  if (options.valueJson !== undefined) {
    try {
      return JSON.parse(options.valueJson) as BrandKitFieldValue;
    } catch (err) {
      throw inputError(
        `Failed to parse --value-json: ${err instanceof Error ? err.message : String(err)}.`,
        'Example for array fields: --value-json \'[{"name":"First entry"},{"name":"Second"}]\''
      );
    }
  }
  return options.value!;
};

const createSetFieldCommand = (): Command => {
  const command = new Command("set-field")
    .description(
      "Directly write a brand kit subsection (field) value, bypassing the AI enrichment pipeline."
    )
    .argument("<kitId>", "Brand kit UUID")
    .argument("<sectionId>", "Section UUID (from `scai brand kits sections <kitId>`)")
    .argument("<fieldId>", "Field UUID (from `scai brand kits fields <kitId> <sectionId>`)")
    .addOption(new Option("--value <text>", "Inline text value (for `text` fields)"))
    .addOption(
      new Option("--value-json <json>", "JSON-encoded value (for `array` / `richArray` fields)")
    )
    .addOption(new Option("--value-file <path>", "Read value text from this file"))
    .addOption(new Option("--verified", "Mark the field as operator-verified"))
    .addOption(new Option("--no-verified", "Clear the verified flag"))
    .addOption(new Option("--ai-editable", "Allow the enrichment pipeline to overwrite this field"))
    .addOption(new Option("--no-ai-editable", "Lock the field against pipeline overwrites"))
    .addOption(new Option("--intent <text>", "Update the AI-facing intent string"))
    .addOption(
      new Option("--format <kind>", "Output format").choices(["text", "json"]).default("text")
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--org-id <id>", "Override orgId from env profile"));
  command.action(
    async (
      kitId: string,
      sectionId: string,
      fieldId: string,
      options: KitsCommonOptions & {
        value?: string;
        valueJson?: string;
        valueFile?: string;
        verified?: boolean;
        aiEditable?: boolean;
        intent?: string;
      }
    ) => {
      const logger = toLogger(options);
      const { client } = resolveClient(options);
      const value = parseFieldValueArg(options);
      const updated = await updateBrandKitField({
        client,
        brandKitId: kitId,
        sectionId,
        fieldId,
        value,
        verified: options.verified,
        aiEditable: options.aiEditable,
        intent: options.intent,
      });
      if (options.format === "json") {
        writeJson(updated);
        return;
      }
      logger.info(`Updated field ${updated.name} (${updated.id}).`, "green");
      logger.info(`  type:     ${updated.type ?? "?"}`);
      logger.info(`  verified: ${updated.verified === true ? "true" : "false"}`);
      const preview =
        typeof updated.value === "string"
          ? updated.value.length > 200
            ? `${updated.value.slice(0, 200)}…`
            : updated.value
          : `(${Array.isArray(updated.value) ? `${updated.value.length} entries` : "object"})`;
      logger.info(`  value:    ${preview}`);
    }
  );
  return command;
};

/**
 * `scai brand kits …` — both read- and write-side brand kit operations.
 *   - `list`      : org-wide kit list
 *   - `get`       : single kit by ID
 *   - `sections`  : list sections (name + ID) of a kit
 *   - `fields`    : list subsections within a section
 *   - `create`    : create a new draft kit
 *   - `publish`   : mark a kit as published (required for pipelines)
 *   - `set-field` : direct PATCH of a field value (the fallback for
 *     AI-generated kits whose PDF didn't survive Sitecore's parser —
 *     see `scai://help/brand-kit-generation`)
 *   - `delete`    : remove a kit (destructive; `-f` to skip prompt)
 *
 * All read commands support `--format text|json`. Use `--format json`
 * for machine-readable output when piping into other tools.
 */
export const createBrandKitsCommand = (): Command => {
  const command = new Command("kits").description(
    "Brand kit operations (list, get, sections, fields, create, publish, set-field, delete)."
  );
  command.addCommand(createListKitsCommand());
  command.addCommand(createGetKitCommand());
  command.addCommand(createSectionsCommand());
  command.addCommand(createFieldsCommand());
  command.addCommand(createCreateKitCommand());
  command.addCommand(createPublishKitCommand());
  command.addCommand(createSetFieldCommand());
  command.addCommand(createDeleteKitCommand());
  return command;
};
