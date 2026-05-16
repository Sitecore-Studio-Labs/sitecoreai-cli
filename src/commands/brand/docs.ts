import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";
import { readRootConfiguration } from "@/config/root-config";
import {
  deleteDocument,
  getDocument,
  listDocuments,
  uploadDocument,
  LOCAL_UPLOAD_UNSUPPORTED_MESSAGE,
  LOCAL_UPLOAD_UNSUPPORTED_HINT,
  type BrandApiClientOptions,
} from "@/brand";
import { confirmDestructive, inputError, toLogger } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import type { CommonOptions } from "@/shared/cli-options";

interface DocsCommonOptions extends CommonOptions {
  environmentName?: string;
  orgId?: string;
  format?: "text" | "json";
}

const resolveClient = (options: DocsCommonOptions): BrandApiClientOptions => {
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
  return { orgId, credential };
};

const writeJson = (value: unknown): void => {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
};

const createUploadCommand = (): Command => {
  const command = new Command("upload")
    .description(
      "Upload a brand document to a kit by URL. Local-file upload is not supported — host the PDF and pass --url."
    )
    .argument("<kitId>", "Brand kit UUID")
    .argument("[file]", "(Unsupported) local file path — host the PDF and use --url instead")
    .addOption(new Option("--url <url>", "Public HTTPS URL to a PDF Sitecore's edge can reach"))
    .addOption(new Option("--title <text>", "Document title"))
    .addOption(new Option("--summary <text>", "Brief description"))
    .addOption(new Option("--type <label>", "Doc type tag (default: 'brand guidelines')"))
    .addOption(new Option("--mime <type>", "MIME type (default: application/pdf)"))
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
      file: string | undefined,
      options: DocsCommonOptions & {
        url?: string;
        title?: string;
        summary?: string;
        type?: string;
        mime?: string;
      }
    ) => {
      const logger = toLogger(options);
      const client = resolveClient(options);
      if (file) {
        throw inputError(LOCAL_UPLOAD_UNSUPPORTED_MESSAGE, LOCAL_UPLOAD_UNSUPPORTED_HINT);
      }
      if (!options.url) {
        throw inputError("A --url is required.", "scai brand docs upload <kitId> --url <pdfUrl>");
      }
      const uploaded = await uploadDocument({
        client,
        brandKitId: kitId,
        source: { url: options.url },
        title: options.title,
        summary: options.summary,
        type: options.type,
        fileType: options.mime,
      });
      if (options.format === "json") {
        writeJson(uploaded);
        return;
      }
      logger.info(`Uploaded ${uploaded.id} (status: ${uploaded.status})`, "green");
      logger.info(
        "\nNext: publish the kit, then `scai brand ingest <kitId>` + `scai brand enrich <kitId>` — or one-shot via `scai brand seed`."
      );
    }
  );
  return command;
};

const createListDocsCommand = (): Command => {
  const command = new Command("list")
    .description("List documents in the org, optionally filtered by kit or status.")
    .addOption(new Option("--kit <id>", "Filter to docs bound to this kit"))
    .addOption(
      new Option("--status <state>", "Filter by status").choices([
        "pending",
        "processed",
        "draft",
        "active",
        "archived",
        "edited",
        "failed",
      ])
    )
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
    async (
      options: DocsCommonOptions & {
        kit?: string;
        status?: string;
        pageNumber?: string;
        pageSize?: string;
      }
    ) => {
      const logger = toLogger(options);
      const client = resolveClient(options);
      const response = await listDocuments({
        client,
        brandKitId: options.kit,
        status: options.status,
        pageNumber: options.pageNumber ? Number(options.pageNumber) : undefined,
        pageSize: options.pageSize ? Number(options.pageSize) : undefined,
      });
      if (options.format === "json") {
        writeJson(response);
        return;
      }
      logger.info(
        `${response.totalCount} doc(s) (page ${response.pageNumber ?? 1}, size ${response.pageSize ?? response.data.length})`
      );
      for (const d of response.data) {
        logger.info(
          `  ${d.id}  ${d.status ?? "?"}  ${d.title ?? "(untitled)"}  kit=${d.brandkitId ?? "?"}  pages=${d.numberOfPages ?? 0}`
        );
      }
    }
  );
  return command;
};

const createGetDocCommand = (): Command => {
  const command = new Command("get")
    .description("Retrieve a document by ID (useful for polling pipeline progress).")
    .argument("<docId>", "Document UUID")
    .addOption(
      new Option("--format <kind>", "Output format").choices(["text", "json"]).default("text")
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--org-id <id>", "Override orgId from env profile"));
  command.action(async (docId: string, options: DocsCommonOptions) => {
    const logger = toLogger(options);
    const client = resolveClient(options);
    const doc = await getDocument({ client, documentId: docId });
    if (options.format === "json") {
      writeJson(doc);
      return;
    }
    logger.info(`Document ${doc.id}`);
    logger.info(`  status:     ${doc.status ?? "?"}`);
    logger.info(`  chunked:    ${doc.chunked ?? "(null)"}`);
    logger.info(`  summarized: ${doc.summarized ?? "(null)"}`);
    logger.info(`  pages:      ${doc.numberOfPages ?? 0}`);
    logger.info(`  type:       ${doc.fileType ?? "?"}`);
    if (doc.title) logger.info(`  title:      ${doc.title}`);
    if (doc.url) logger.info(`  url:        ${doc.url}`);
    if (doc.brandkitId) logger.info(`  kit:        ${doc.brandkitId}`);
    if (doc.tags?.length) logger.info(`  tags:       ${doc.tags.join(", ")}`);
  });
  return command;
};

const createDeleteDocCommand = (): Command => {
  const command = new Command("delete")
    .description("Delete a document. Destructive — requires --force or confirmation.")
    .argument("<docId>", "Document UUID")
    .addOption(new Option("-f, --force", "Skip the confirmation prompt"));
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--org-id <id>", "Override orgId from env profile"));
  command.action(async (docId: string, options: DocsCommonOptions & { force?: boolean }) => {
    const logger = toLogger(options);
    const client = resolveClient(options);
    const doc = await getDocument({ client, documentId: docId });
    logger.info(`About to delete: ${doc.title ?? "(untitled)"} (${doc.id}) [${doc.status}]`);
    const proceed = await confirmDestructive(
      `Delete document '${doc.title ?? doc.id}'?`,
      options.force
    );
    if (!proceed) {
      logger.info("Aborted.");
      return;
    }
    await deleteDocument({ client, documentId: docId });
    logger.info(`Deleted document ${docId}.`, "green");
  });
  return command;
};

/**
 * `scai brand docs …` — document lifecycle within brand kits.
 *   - `upload <kitId> [file] [--url]` : upload a PDF (local ≤1MB, or URL)
 *   - `list [--kit X] [--status X]`   : list documents
 *   - `get <docId>`                   : single document (pipeline progress)
 *   - `delete <docId>`                : delete (destructive)
 */
export const createBrandDocsCommand = (): Command => {
  const command = new Command("docs").description(
    "Brand document operations (upload, list, get, delete)."
  );
  command.addCommand(createUploadCommand());
  command.addCommand(createListDocsCommand());
  command.addCommand(createGetDocCommand());
  command.addCommand(createDeleteDocCommand());
  return command;
};
