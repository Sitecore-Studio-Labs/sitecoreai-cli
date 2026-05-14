/**
 * Tool dispatch — wraps each registered handler with:
 *
 *  1. Concurrency via an in-house read/write lock. The stdio transport
 *     receives requests one-at-a-time, but the SDK does not serialize
 *     tool calls on its own. Multiple read tools (`*_inspect`,
 *     `environment_status`, …) run concurrently; writes are exclusive
 *     against everything. Writer preference keeps a queued
 *     `recipe_push` from starving behind a stream of reads.
 *
 *     v1 used a single Promise-chain mutex that serialized every tool
 *     call. The rwlock keeps the write-time correctness guarantee
 *     (mutations don't observe each other's half-applied state) while
 *     letting read fan-out cost what it should.
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
import { RwLock } from "@/shared/rwlock";
import type { McpContext } from "./auth";
import { toolResultFromError } from "./errors";
import type { ToolDescriptor, ToolExtra } from "./registry";
import { ALLOW_WRITE_ERROR_HINT } from "./schemas/common";
import { redactStructured } from "./redact";

const lock = new RwLock();

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
): Promise<CallToolResult> => {
  const run = async (): Promise<CallToolResult> => {
    // Short-circuit if the client already cancelled while waiting on the
    // lock. Holding the lock for the no-op return is negligible.
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
  };

  return descriptor.auth === "write" ? lock.withWrite(run) : lock.withRead(run);
};

/**
 * Test-only helper to reset the dispatch lock between tests so the
 * rwlock's pending-queue state doesn't carry across `describe` blocks.
 */
export const __resetDispatchLockForTests = (): void => {
  lock.reset();
};
