import fs from "node:fs";
import path from "node:path";
import type { CommonOptions } from "@/shared/cli-options";
import { toLogger } from "@/shared/cli-tasks";

/**
 * `scai provision deploy build-config` — create or update `xmcloud.build.json`,
 * the XM Cloud Deploy build manifest a head app needs so the Deploy service
 * knows how to build + run its rendering (editing) host. Adds or updates one
 * rendering-host entry and merges into any existing file (other hosts and
 * `postActions` are preserved).
 *
 * Pure file operation — no Deploy API call, no tenant auth. Pair it with the
 * Deploy API verbs (`deploy environments`, `deploy editing-host`) when wiring a
 * repo for deployment.
 */

// Content SDK 2.1+ needs Node >= 24 on the XM Cloud build host (else builds log
// EBADENGINE). Bump as the SDK's floor moves.
export const DEFAULT_NODE_VERSION = "24.10.0";
export const DEFAULT_RENDERING_HOST_NAME = "editing-host-name";

export interface RenderingHostConfig {
  path: string;
  nodeVersion: string;
  jssDeploymentSecret: string;
  enabled: boolean;
  type: string;
  installCommand: string;
  buildCommand: string;
  runCommand: string;
}

export interface XmcloudBuildConfig {
  renderingHosts: Record<string, unknown>;
  postActions?: unknown;
  [key: string]: unknown;
}

/** The OOTB scaffold's defaults — used as the base when no file exists yet. */
const defaultBuildConfig = (): XmcloudBuildConfig => ({
  renderingHosts: {},
  postActions: {
    actions: {
      warmUpCm: {
        urls: [
          "/sitecore/shell",
          "/sitecore/shell/Applications/Content%20Editor.aspx?sc_bw=1",
          "/sitecore/client/Applications/Launchpad",
        ],
      },
      populateSchema: { indexNames: [] },
      reindex: { indexNames: [] },
    },
  },
});

export interface RenderingHostParams {
  renderingHostName: string;
  jssDeploymentSecret: string;
  enabled: boolean;
  nodeVersion: string;
  hostPath: string;
  type: string;
  installCommand: string;
  buildCommand: string;
  runCommand: string;
  /** Drop the OOTB `editing-host-name` host when adding a renamed one. */
  removeDefault: boolean;
}

/**
 * Pure: merge a rendering-host entry into an existing (or default) config.
 * Preserves unknown top-level keys, sibling rendering hosts, and any extra
 * fields already on the target host. Exposed for unit tests.
 */
export const applyRenderingHost = (
  existing: XmcloudBuildConfig | null,
  params: RenderingHostParams
): XmcloudBuildConfig => {
  const base =
    existing && typeof existing === "object"
      ? { ...defaultBuildConfig(), ...existing }
      : defaultBuildConfig();
  const hosts: Record<string, unknown> =
    base.renderingHosts && typeof base.renderingHosts === "object"
      ? { ...base.renderingHosts }
      : {};

  if (params.removeDefault && params.renderingHostName !== DEFAULT_RENDERING_HOST_NAME) {
    delete hosts[DEFAULT_RENDERING_HOST_NAME];
  }

  const previous = hosts[params.renderingHostName];
  const host: RenderingHostConfig = {
    ...(previous && typeof previous === "object" ? (previous as object) : {}),
    path: params.hostPath,
    nodeVersion: params.nodeVersion,
    jssDeploymentSecret: params.jssDeploymentSecret,
    enabled: params.enabled,
    type: params.type,
    installCommand: params.installCommand,
    buildCommand: params.buildCommand,
    runCommand: params.runCommand,
  };
  hosts[params.renderingHostName] = host;
  return { ...base, renderingHosts: hosts };
};

export type DeployBuildConfigOptions = CommonOptions & {
  renderingHost?: string;
  secret?: string;
  enabled?: boolean;
  nodeVersion?: string;
  hostPath?: string;
  type?: string;
  installCommand?: string;
  buildCommand?: string;
  runCommand?: string;
  removeDefault?: boolean;
  output?: string;
  whatIf?: boolean;
};

export const runDeployBuildConfig = async (options: DeployBuildConfigOptions): Promise<void> => {
  const logger = toLogger(options);
  const outputPath = path.resolve(options.output ?? path.join(process.cwd(), "xmcloud.build.json"));

  let existing: XmcloudBuildConfig | null = null;
  if (fs.existsSync(outputPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
      if (parsed && typeof parsed === "object") existing = parsed as XmcloudBuildConfig;
    } catch {
      // Corrupt/non-JSON file → start from defaults rather than fail.
      existing = null;
    }
  }

  const renderingHostName = options.renderingHost?.trim() || DEFAULT_RENDERING_HOST_NAME;
  const config = applyRenderingHost(existing, {
    renderingHostName,
    jssDeploymentSecret: options.secret?.trim() || "[Add Obtained Token Here]",
    enabled: options.enabled ?? true,
    nodeVersion: options.nodeVersion?.trim() || DEFAULT_NODE_VERSION,
    hostPath: options.hostPath?.trim() || "./",
    type: options.type?.trim() || "sxa",
    installCommand: options.installCommand?.trim() || "npm install",
    buildCommand: options.buildCommand?.trim() || "npm run build",
    runCommand: options.runCommand?.trim() || "next:start",
    removeDefault: Boolean(options.removeDefault),
  });

  const serialized = `${JSON.stringify(config, null, 2)}\n`;

  if (options.whatIf) {
    if (logger.isJson()) {
      logger.json({ command: "deploy.build-config", output: outputPath, whatIf: true, config });
    } else {
      logger.info(`[dry-run] would write ${outputPath}:`, "yellow");
      logger.info(serialized);
    }
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);

  if (logger.isJson()) {
    logger.json({
      command: "deploy.build-config",
      output: outputPath,
      renderingHost: renderingHostName,
      config,
    });
  } else {
    logger.info(`Wrote ${outputPath} (rendering host '${renderingHostName}').`, "green");
  }
};
