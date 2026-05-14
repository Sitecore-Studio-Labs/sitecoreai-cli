/**
 * Tool dispatch — wraps each registered handler with:
 *
 *  1. Serialization via a single in-house mutex (Promise chain). The
 *     stdio transport receives requests one-at-a-time, but the SDK
 *     does not serialize tool calls on its own; serializing here keeps
 *     library state (token cache, fetched env metadata) coherent and
 *     side-steps a class of race conditions in v1. Documented as a
 *     known limitation in `docs/mcp.md`.
 *
 *  2. The per-call `allowWrite` gate. Write-typed tools that receive
 *     `allowWrite !== true` short-circuit to an INPUT_INVALID envelope
 *     before the handler runs — no side effects, no library import.
 *
 *  3. The cancellation gate. The SDK's `RequestHandlerExtra.signal`
 *     fires `aborted` when the client sends `notifications/cancelled`.
 *     We thread that signal through to the handler (and the handler
 *     plumbs it into the library). When the handler returns AND
 *     `signal.aborted` is true, we convert the result to a `CANCELLED`
 *     envelope so the client sees consistent typed-error shape rather
 *     than a half-applied success.
 *
 *  4. Error envelope conversion. Anything the handler throws (or any
 *     ScaiError it returns by raising) lands in `toolResultFromError`
 *     and crosses the wire as `{ isError: true, content, structuredContent }`.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createScaiError } from "@/shared/errors";
import type { McpContext } from "./auth";
import { toolResultFromError } from "./errors";
import type { ToolDescriptor, ToolExtra } from "./registry";
import { ALLOW_WRITE_ERROR_HINT } from "./schemas/common";
import { redactStructured } from "./redact";

let mutex: Promise<unknown> = Promise.resolve();

const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const next = mutex.then(task, task);
  // Keep the chain alive even if a previous task rejected — we never
  // want one tool failure to wedge dispatch for subsequent calls.
  mutex = next.catch(() => undefined);
  return next;
};

export interface DispatchOptions {
  context: McpContext;
  extra: ToolExtra;
}

const cancelledEnvelope = (toolName: string): CallToolResult =>
  toolResultFromError(
    createScaiError(`Tool '${toolName}' was cancelled by the client.`, "CANCELLED", {
      hint: "Re-invoke the same tool to resume; partially-applied writes (if any) are documented in the tool result.",
    })
  );

export const dispatchTool = async (
  descriptor: ToolDescriptor,
  input: Record<string, unknown>,
  options: DispatchOptions
): Promise<CallToolResult> =>
  enqueue(async () => {
    // Short-circuit if the client already cancelled before dispatch got
    // a slot on the mutex.
    if (options.extra.signal.aborted) {
      return cancelledEnvelope(descriptor.name);
    }
    try {
      if (descriptor.auth === "write") {
        const allowWrite = input["allowWrite"] === true;
        if (!allowWrite) {
          throw createScaiError(
            `Tool '${descriptor.name}' is a write operation. Set 'allowWrite: true' to authorize the change.`,
            "INPUT_INVALID",
            { hint: ALLOW_WRITE_ERROR_HINT }
          );
        }
      }
      const result = await descriptor.handler(input as never, options.context, options.extra);
      // If the handler returned a non-error result but the client
      // cancelled while it ran, convert it to a CANCELLED envelope so
      // the client doesn't see "success" for work it asked to stop.
      if (options.extra.signal.aborted && !result.isError) {
        return cancelledEnvelope(descriptor.name);
      }
      if (result.isError) {
        return result;
      }
      if (result.structuredContent) {
        return {
          ...result,
          structuredContent: redactStructured(result.structuredContent) as Record<string, unknown>,
        };
      }
      return result;
    } catch (error) {
      // AbortError from an aborted library call surfaces as a thrown
      // DOMException-shaped error. Coerce to CANCELLED for the envelope.
      if (options.extra.signal.aborted) {
        return cancelledEnvelope(descriptor.name);
      }
      return toolResultFromError(error);
    }
  });

/**
 * Test-only helper to reset the dispatch mutex between tests so the
 * Promise chain doesn't carry state across `describe` blocks.
 */
export const __resetDispatchMutexForTests = (): void => {
  mutex = Promise.resolve();
};
