/**
 * Agentic Studio resource shapes.
 *
 * Modeled against the live BFF. The API is unversioned, so
 * shapes carry `[key: string]: unknown` index signatures and optional
 * fields — callers parse defensively and never assume a field is present.
 */

/** The tool toggles on an agent's config. Each maps to a `/api/tools` entry. */
export interface AgentToolToggles {
  enableArtifacts?: boolean;
  enableContextRetrieval?: boolean;
  enableSitecoreContext?: boolean;
  enableWebSearch?: boolean;
  enableImageGeneration?: boolean;
  enableInsightsData?: boolean;
  enableAgentApiSites?: boolean;
  enableAgentApiPages?: boolean;
  enableAgentApiContent?: boolean;
  enableAgentApiComponents?: boolean;
  enableAgentApiAssets?: boolean;
  enableAgentApiPersonalization?: boolean;
  enableAgentApiJobs?: boolean;
  enableAgentApiBriefs?: boolean;
  enableAgentApiBrandKits?: boolean;
  enableStructuredOutput?: boolean;
}

/** Agent output mode. `structured` pairs with a `/api/schemas` schema. */
export interface AgentOutput {
  format: "text" | "structured";
  dynamic?: boolean;
}

export interface AgentConfig {
  /** "standard" for a prompt+tools agent; workflow agents also carry a graph. */
  executionMode: string;
  tools: AgentToolToggles;
  defaultContext: unknown[];
  /** Skill UUIDs (see `/api/skills`). */
  skills: string[];
  output: AgentOutput;
  /** Workflow agents carry a `nodes` graph here — passed through untyped. */
  [key: string]: unknown;
}

export interface Agent {
  id: string;
  slug: string;
  name?: string;
  description?: string;
  prompt?: string;
  tags?: string[];
  config?: AgentConfig;
  isPredefined?: boolean;
  [key: string]: unknown;
}

/** A `/api/tools` catalog entry. `category` is agent_api | context | standard. */
export interface Tool {
  id: string;
  toolKey: string;
  label: string;
  description: string;
  category: string;
  isEnabled: boolean;
  accessLevel?: string;
  updatedAt?: string;
}

/**
 * A `/api/skills` skill — reusable markdown guidance an agent attaches.
 * `content` is the markdown; `visibility` is e.g. "team" | "private".
 */
export interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string;
  content?: string;
  tags?: string[];
  visibility?: string;
  isSystem?: boolean;
  isEnabled?: boolean;
  source?: string;
  ownerUserId?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** A scheduled run from `/api/scheduled-runs`. */
export interface ScheduledRun {
  id: string;
  name?: string;
  cronExpression?: string;
  timezone?: string;
  status?: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

/** One agent slot in a space's config. */
export interface SpaceAgentRef {
  /** Agent slug (standard agent) or flow id (workflow). */
  slug: string;
  title: string;
  instanceId: string;
}

/** What a run launches. `graphType` is the agent slug or flow id. */
export interface SpaceLaunchTarget {
  kind: "agent" | "flow";
  graphType: string;
}

export interface SpaceConfig {
  purpose: string;
  workPattern: string;
  spaceName: string;
  globalContext: { objective: string };
  items: unknown[];
  agents: SpaceAgentRef[];
  agentExecutionMode: string;
  launchTarget?: SpaceLaunchTarget;
}

/**
 * One Server-Sent event from a `chatv2` run. The taxonomy is large and
 * reverse-engineered (`start`, `text-delta`, `data-workflow-update`,
 * `data-artifactDelta`, `finish`, …); `type` is always present, the rest
 * is event-specific.
 */
export interface RunEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * A widget's declarative UI spec — a tree of typed elements. An element's
 * props may carry `{ $state: "/path" }` bindings to runtime state.
 */
export interface WidgetSpec {
  root: string;
  elements: Record<string, unknown>;
}

/** A `/api/widgets` widget — a configurable report/dashboard surface. */
export interface Widget {
  id: string;
  name: string;
  description?: string | null;
  spec?: WidgetSpec;
  [key: string]: unknown;
}

/** A registered external MCP server (`/api/custom-mcps`). */
export interface CustomMcp {
  id: string;
  name: string;
  url: string;
  isEnabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** A structured-output schema (`/api/schemas`). */
export interface StructuredSchema {
  id?: string;
  schemaId?: string;
  name: string;
  description?: string;
  /** The JSON-Schema definition (shape varies). */
  fields?: unknown;
  tags?: string[];
  [key: string]: unknown;
}

/** An HTML template (`/api/html-templates`). */
export interface HtmlTemplate {
  id: string;
  templateId?: string;
  name?: string;
  description?: string;
  /** The template's HTML body. */
  code?: string;
  tags?: string[];
  contextId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}
