/**
 * `scai health` — fan-out probe across every environment in the active
 * tenant. Picks the right probe per type:
 *   - CM:  GET <host>/healthz/ready
 *   - EH:  most-recent deployment status (the editing-host's deploy-API
 *          hostname is internal and doesn't resolve over the public
 *          internet, so /healthz/ready isn't reachable from a laptop)
 *   - unprovisioned: skipped — never had a deployment to probe
 *
 * Designed to answer "what's the health of all my environments?" in
 * one shot. The narrower `scai deploy environments health` command
 * stays around for single-env probes by ID/name.
 */

import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  fetchAllEnvironments,
  fetchEnvironmentDeployments,
  fetchProjectEnvironments,
  getProvisioningStatus,
  probeEnvironmentHealth,
  resolveHostFromEnvironment,
} from "@/deploy/api";
import type {
  DeployEnvironment,
  DeployEnvironmentProvisioningStatus,
} from "@/deploy/api";
import {
  getDeployContext,
  getEnvironmentType,
  printDeployResultWithContext,
  resolveDeployProjectId,
  toLogger,
} from "./shared";
import type { Logger } from "@/shared/logger";
import type { DeployBaseOptions } from "./types";

export type DeployHealthOptions = DeployBaseOptions & {
  project?: string;
  type?: string;
  /** Skip per-environment probes — list status only. */
  noProbe?: boolean;
  /** Per-env probe concurrency. Default 8. */
  concurrency?: number;
};

type CmProbe = {
  kind: "healthz";
  url: string;
  status: number;
  ok: boolean;
};

type EhProbe = {
  kind: "deployment";
  deploymentId?: string;
  status?: string;
  createdAt?: string;
  completedAt?: string;
};

type SkippedProbe = {
  kind: "skipped";
  reason: string;
};

type EnvironmentHealthReport = {
  id?: string;
  name?: string;
  type: string;
  provisioningStatus: DeployEnvironmentProvisioningStatus;
  probe?: CmProbe | EhProbe | SkippedProbe;
  error?: string;
};

const TYPE_COLUMN_FALLBACK = "unknown";

const collectEnvironments = async (
  context: {
    token: string;
    baseUrl?: string;
    whatIf?: boolean;
  },
  options: DeployHealthOptions
): Promise<DeployEnvironment[]> => {
  const apiOptions = { accessToken: context.token, baseUrl: context.baseUrl };
  const projectId = await resolveDeployProjectId(context, options);
  if (projectId) {
    const result = (await fetchProjectEnvironments(apiOptions, projectId)) as
      | DeployEnvironment[]
      | { items?: DeployEnvironment[]; data?: DeployEnvironment[] };
    if (Array.isArray(result)) {
      return result;
    }
    return result?.items ?? result?.data ?? [];
  }
  const aggregated = await fetchAllEnvironments(apiOptions, {}, 50);
  return aggregated.items;
};

const sortLatestFirst = <T extends { createdAt?: string; startedAt?: string }>(
  list: T[]
): T[] =>
  [...list].sort((a, b) =>
    String(b.createdAt ?? b.startedAt ?? "").localeCompare(
      String(a.createdAt ?? a.startedAt ?? "")
    )
  );

const probeEnvironment = async (
  apiOptions: { accessToken: string; baseUrl?: string },
  env: DeployEnvironment,
  status: DeployEnvironmentProvisioningStatus,
  type: string,
  shouldProbe: boolean
): Promise<EnvironmentHealthReport["probe"]> => {
  if (!shouldProbe) {
    return { kind: "skipped", reason: "Probe disabled (--no-probe)." };
  }
  if (status === "unprovisioned") {
    return { kind: "skipped", reason: "Environment has never been provisioned." };
  }
  if (type === "cm") {
    const host = resolveHostFromEnvironment(env);
    if (!host) {
      return { kind: "skipped", reason: "No resolvable CM host." };
    }
    const probe = await probeEnvironmentHealth(host, 10_000);
    return { kind: "healthz", url: probe.url, status: probe.status, ok: probe.ok };
  }
  const envId = env.id ?? env.environmentId;
  if (!envId) {
    return { kind: "skipped", reason: "Missing environment ID." };
  }
  const dep = (await fetchEnvironmentDeployments(apiOptions, envId)) as
    | { data?: unknown[]; deployments?: unknown[] }
    | unknown[];
  const list = Array.isArray(dep)
    ? (dep as Array<Record<string, unknown>>)
    : ((dep?.data as Array<Record<string, unknown>>) ??
       (dep?.deployments as Array<Record<string, unknown>>) ??
       []);
  if (list.length === 0) {
    return { kind: "skipped", reason: "No deployments found." };
  }
  const latest = sortLatestFirst(
    list as Array<{ createdAt?: string; startedAt?: string }>
  )[0] as Record<string, unknown>;
  return {
    kind: "deployment",
    deploymentId: typeof latest.id === "string" ? latest.id : undefined,
    status:
      (typeof latest.statusName === "string" && latest.statusName) ||
      (typeof latest.status === "string" && latest.status) ||
      (typeof latest.deploymentStatus === "string" && latest.deploymentStatus) ||
      undefined,
    createdAt: typeof latest.createdAt === "string" ? latest.createdAt : undefined,
    completedAt:
      typeof latest.completedAt === "string" ? latest.completedAt : undefined,
  };
};

const summarizeReports = (
  reports: EnvironmentHealthReport[]
): Record<string, { total: number; byStatus: Record<string, number> }> => {
  const summary: Record<string, { total: number; byStatus: Record<string, number> }> =
    {};
  for (const report of reports) {
    const bucket = summary[report.type] ?? { total: 0, byStatus: {} };
    bucket.total += 1;
    bucket.byStatus[report.provisioningStatus] =
      (bucket.byStatus[report.provisioningStatus] ?? 0) + 1;
    summary[report.type] = bucket;
  }
  return summary;
};

const probeSignal = (report: EnvironmentHealthReport): string => {
  if (report.error) {
    return `error: ${report.error}`;
  }
  const probe = report.probe;
  if (!probe) {
    return "-";
  }
  if (probe.kind === "healthz") {
    return `${probe.status} ${probe.ok ? "OK" : "FAIL"}`;
  }
  if (probe.kind === "deployment") {
    return probe.status ?? "deployment: (no status)";
  }
  return probe.reason;
};

const padCell = (value: string, width: number): string =>
  value.length >= width ? value : value + " ".repeat(width - value.length);

const renderTable = (logger: Logger, reports: EnvironmentHealthReport[]): void => {
  if (reports.length === 0) {
    logger.info("No environments to report.", "yellow");
    return;
  }
  const rows = reports.map((report) => ({
    name: report.name ?? report.id ?? "(unknown)",
    type: report.type || TYPE_COLUMN_FALLBACK,
    status: report.provisioningStatus,
    signal: probeSignal(report),
  }));
  const widths = {
    name: Math.max(4, ...rows.map((row) => row.name.length)),
    type: Math.max(4, ...rows.map((row) => row.type.length)),
    status: Math.max(6, ...rows.map((row) => row.status.length)),
    signal: Math.max(6, ...rows.map((row) => row.signal.length)),
  };
  const header = `${padCell("NAME", widths.name)}  ${padCell("TYPE", widths.type)}  ${padCell(
    "STATUS",
    widths.status
  )}  ${padCell("SIGNAL", widths.signal)}`;
  logger.info(header, "cyan");
  for (const row of rows) {
    logger.info(
      `${padCell(row.name, widths.name)}  ${padCell(row.type, widths.type)}  ${padCell(
        row.status,
        widths.status
      )}  ${padCell(row.signal, widths.signal)}`
    );
  }
};

const renderSummary = (
  logger: Logger,
  summary: Record<string, { total: number; byStatus: Record<string, number> }>
): void => {
  const types = Object.keys(summary).sort();
  if (types.length === 0) {
    return;
  }
  logger.info("", "gray");
  for (const type of types) {
    const bucket = summary[type];
    const parts = Object.entries(bucket.byStatus)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => `${count} ${key}`);
    logger.info(`${type}: ${bucket.total} (${parts.join(", ")})`, "gray");
  }
};

export const runDeployHealth = async (options: DeployHealthOptions): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const apiOptions = { accessToken: context.token, baseUrl: context.baseUrl };

  let environments = await collectEnvironments(context, options);
  const normalizedType = options.type?.toLowerCase();
  if (normalizedType) {
    environments = environments.filter((env) => {
      const envType = getEnvironmentType(env);
      return envType ? envType.toLowerCase().includes(normalizedType) : false;
    });
  }

  const shouldProbe = !options.noProbe;
  const concurrency = options.concurrency ?? 8;

  const reports = await mapWithConcurrency(
    environments,
    async (env): Promise<EnvironmentHealthReport> => {
      const status = getProvisioningStatus(env);
      const type = (getEnvironmentType(env) ?? "").toLowerCase();
      const base: EnvironmentHealthReport = {
        id: env.id ?? env.environmentId,
        name: env.name,
        type: type || TYPE_COLUMN_FALLBACK,
        provisioningStatus: status,
      };
      try {
        base.probe = await probeEnvironment(apiOptions, env, status, type, shouldProbe);
      } catch (error) {
        base.error = error instanceof Error ? error.message : String(error);
      }
      return base;
    },
    concurrency
  );

  const summary = summarizeReports(reports);

  if (logger.isJson()) {
    printDeployResultWithContext(logger, context, "health", {
      totalCount: reports.length,
      summary,
      environments: reports,
    });
    return;
  }

  renderTable(logger, reports);
  renderSummary(logger, summary);
};
