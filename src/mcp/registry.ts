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
} from "@modelcontextprotocol/sdk/types.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z, ZodRawShape } from "zod";
import type { McpContext } from "./auth";

export type ToolAuth = "read" | "write";

export interface ToolDescriptor<TShape extends ZodRawShape = ZodRawShape> {
  name: string;
  /** Short, agent-readable summary. Hand-authored, ≥50 chars. */
  description: string;
  /** Annotations always required (title + readOnlyHint + destructiveHint + openWorldHint). */
  annotations: ToolAnnotations;
  /** Discriminator that drives the dispatch-time `allowWrite` gate. */
  auth: ToolAuth;
  /** Zod raw shape for the SDK's input validation. May be empty. */
  inputSchema: TShape;
  /** Tool handler. Receives the typed input + bound context. */
  handler: (
    input: z.infer<z.ZodObject<TShape>>,
    context: McpContext
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
