/**
 * In-house registry for scai MCP tools, resources, and prompts.
 *
 * Sits one layer above the MCP SDK's `McpServer` so we can:
 *   - serialize tool calls through a single mutex (see `dispatch.ts`),
 *   - enforce the per-call `allowWrite` gate before any side-effecting
 *     library call runs,
 *   - centralize the typed error envelope on the inner handler's
 *     return path,
 *   - expose `tools_list` / `tools_schema` for human + agent inspection
 *     without round-tripping through SDK introspection.
 *
 * Tool authors register handlers against this registry; `server.ts`
 * walks the registry and forwards each entry to the SDK at startup.
 */

import type {
  CallToolResult,
  ReadResourceResult,
  GetPromptResult,
  Notification,
} from "@modelcontextprotocol/sdk/types.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z, ZodRawShape } from "zod";
import type { McpContext } from "./auth";

/**
 * Auth class driving the dispatch-level `allowWrite` gate.
 *
 *   - `read`               — no `allowWrite` required.
 *   - `write`              — `allowWrite: true` required at dispatch.
 *   - `verb-discriminated` — handler decides per `verb` / `direction`
 *     discriminator. Use for tools whose verb space mixes read verbs and
 *     write verbs and whose write verbs are clearly named.
 *
 *     Declare the writing verbs on the descriptor via `writeVerbs` (and
 *     `verbField` when the discriminator isn't named `verb`). Dispatch
 *     then centrally enforces `allowWrite: true` whenever the call's verb
 *     is in that list — plus the same retargeted-env elevation gate the
 *     `write` class gets. This closes the foot-gun where a NEW write verb
 *     could slip through unguarded if a handler forgot its own check.
 *     Handlers may still add CONDITIONAL gating that a flat verb list
 *     can't express (e.g. serialization's `diff` is a write only when
 *     `pushOnDiff` is set), and remain responsible for the bound-env
 *     elevation check; the dispatch gate is a necessary floor, not the
 *     whole policy. When `writeVerbs` is omitted, dispatch adds no gate
 *     (legacy behavior — the handler owns all enforcement).
 */
export type ToolAuth = "read" | "write" | "verb-discriminated";

/**
 * Per-call extras handed to every tool handler. Carries the cancellation
 * signal, the progress-notification sender, and the optional progress
 * token threaded by the client.
 *
 *  - `signal` fires `aborted` when the client cancels the request
 *    (MCP `notifications/cancelled`). Handlers that wrap long-running
 *    operations should plumb this into the library so work stops
 *    promptly; the dispatcher converts the aborted state into a
 *    `CANCELLED` envelope after the handler returns.
 *  - `sendProgress` is a no-op when the client didn't supply a
 *    `progressToken`, so handlers can call it unconditionally.
 */
export interface ToolExtra {
  signal: AbortSignal;
  /** Token the client supplied; absent when the client didn't request progress. */
  progressToken: string | number | undefined;
  /**
   * Emit a progress notification to the client. No-op when `progressToken`
   * is absent. Always returns successfully (errors are swallowed and
   * traced via stderr); progress is advisory, never load-bearing.
   */
  sendProgress: (progress: number, total: number | undefined, message?: string) => Promise<void>;
  /** Lower-level escape hatch — send any notification frame. */
  sendNotification: (notification: Notification) => Promise<void>;
}

export interface ToolDescriptor<TShape extends ZodRawShape = ZodRawShape> {
  name: string;
  /** Short, agent-readable summary. Hand-authored, ≥50 chars. */
  description: string;
  /** Annotations always required (title + readOnlyHint + destructiveHint + openWorldHint). */
  annotations: ToolAnnotations;
  /** Discriminator that drives the dispatch-time `allowWrite` gate. */
  auth: ToolAuth;
  /**
   * For `auth: "verb-discriminated"` tools: the verbs that mutate the
   * tenant. When the call's discriminator value is in this list, dispatch
   * enforces `allowWrite: true` and the retargeted-env elevation gate
   * centrally (mirroring the `write` class). Ignored for `read` / `write`
   * tools. Omit to keep the legacy "handler owns all enforcement" behavior.
   */
  writeVerbs?: readonly string[];
  /**
   * Field name carrying the verb discriminator for `writeVerbs` matching.
   * Defaults to `"verb"`; set to `"direction"` (etc.) when the tool names
   * its discriminator differently.
   */
  verbField?: string;
  /** Zod raw shape for the SDK's input validation. May be empty. */
  inputSchema: TShape;
  /** Tool handler. Receives the typed input, bound context, and per-call extras. */
  handler: (
    input: z.infer<z.ZodObject<TShape>>,
    context: McpContext,
    extra: ToolExtra
  ) => CallToolResult | Promise<CallToolResult>;
}

export interface ResourceDescriptor {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: (context: McpContext) => ReadResourceResult | Promise<ReadResourceResult>;
}

export interface PromptDescriptor<TShape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  argsSchema: TShape;
  handler: (
    args: z.infer<z.ZodObject<TShape>>,
    context: McpContext
  ) => GetPromptResult | Promise<GetPromptResult>;
}

export class McpRegistry {
  private readonly tools = new Map<string, ToolDescriptor>();
  private readonly resources = new Map<string, ResourceDescriptor>();
  private readonly prompts = new Map<string, PromptDescriptor>();

  registerTool<TShape extends ZodRawShape>(descriptor: ToolDescriptor<TShape>): void {
    if (this.tools.has(descriptor.name)) {
      throw new Error(`Duplicate tool registration: '${descriptor.name}'.`);
    }
    if (!descriptor.description || descriptor.description.length < 50) {
      throw new Error(
        `Tool '${descriptor.name}' description must be at least 50 characters (got ${descriptor.description?.length ?? 0}).`
      );
    }
    if (!descriptor.annotations.title) {
      throw new Error(`Tool '${descriptor.name}' must declare annotations.title.`);
    }
    this.tools.set(descriptor.name, descriptor as unknown as ToolDescriptor);
  }

  registerResource(descriptor: ResourceDescriptor): void {
    if (this.resources.has(descriptor.uri)) {
      throw new Error(`Duplicate resource registration: '${descriptor.uri}'.`);
    }
    this.resources.set(descriptor.uri, descriptor);
  }

  registerPrompt<TShape extends ZodRawShape>(descriptor: PromptDescriptor<TShape>): void {
    if (this.prompts.has(descriptor.name)) {
      throw new Error(`Duplicate prompt registration: '${descriptor.name}'.`);
    }
    this.prompts.set(descriptor.name, descriptor as unknown as PromptDescriptor);
  }

  getTool(name: string): ToolDescriptor | undefined {
    return this.tools.get(name);
  }

  listTools(): ToolDescriptor[] {
    return Array.from(this.tools.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  listResources(): ResourceDescriptor[] {
    return Array.from(this.resources.values()).sort((a, b) => a.uri.localeCompare(b.uri));
  }

  listPrompts(): PromptDescriptor[] {
    return Array.from(this.prompts.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
}
