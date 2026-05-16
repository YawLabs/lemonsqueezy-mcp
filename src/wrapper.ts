/**
 * MCP tool wrapper and audit-log Resource handler.
 *
 * Extracted from `index.ts` so unit tests can exercise the wrapper without
 * starting the stdio MCP server. The registration loop in `index.ts` is the
 * only production caller; everything below sits between the SDK's registered
 * tool handler and the per-resource handlers in `src/tools/*.ts`.
 *
 * Order of operations is load-bearing -- see the comment on
 * `createToolHandler` for the rationale.
 */

import { pushAuditEntry, readAuditEntries } from "./audit-buffer.js";
import {
  type AuthorityClass,
  checkClassAllowed,
  checkClassRateLimit,
  checkDestructiveRateLimit,
  checkStoreScopedToolInput,
  GuardrailError,
  isDestructiveCall,
} from "./guardrails.js";
import { logEvent, wouldLogToolCall } from "./logger.js";
import { redactSecrets } from "./redact.js";

export type McpToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export type ToolHandlerResponse = {
  ok: boolean;
  data?: unknown;
  error?: string;
  requestId?: string;
};

// Per-resource tool modules export arrays with strict, schema-derived input
// types on each handler (e.g. `(input: { storeId: string; ... }) => ...`).
// Function parameter types are contravariant, so two tools with different
// strict input types cannot coexist in `RegisterableTool[]` without widening.
//
// The generic parameter `TInput` carries the strict per-tool input type
// when callers want it (`createToolHandler<{ storeId: string }>(tool)`
// preserves the input type through the wrapped function). The default
// `unknown` is what the heterogeneous registration loop in `index.ts`
// uses -- it accepts any concrete `TInput` because handler-input slots
// are contravariant on TInput, and `unknown` widens to any of them.
// `isDestructive` and `inputSchema.shape` use `any` for the same reason
// (the SDK accepts the per-tool Zod object shape verbatim).
//
// The RETURN type (`Promise<ToolHandlerResponse>`) is NOT widened: a
// handler returning the wrong shape is caught at registration time.
// Verified by the `@ts-expect-error` cases in the
// "createToolHandler return-shape strictness" block of `wrapper.test.ts`,
// and by the fact that every per-resource tool handler returns
// `Promise<ApiResponse<T>>`, which is a structural subtype of
// `ToolHandlerResponse`.
export type RegisterableTool<TInput = unknown> = {
  name: string;
  description: string;
  authorityClass: AuthorityClass;
  // SDK annotations include title / readOnlyHint / destructiveHint /
  // idempotentHint / openWorldHint and are passed through verbatim.
  // biome-ignore lint/suspicious/noExplicitAny: see RegisterableTool comment
  annotations?: any;
  // biome-ignore lint/suspicious/noExplicitAny: see RegisterableTool comment
  inputSchema: { shape: any };
  isDestructive?: (input: TInput) => boolean;
  requiredFilters?: readonly string[];
  handler: (input: TInput) => Promise<ToolHandlerResponse>;
};

/**
 * Build the wrapper that McpServer.tool will invoke for `tool`.
 *
 * Order of operations:
 *
 *   1. Compute `isDestructive` once from the input (some tools use a
 *      predicate, e.g. ls_update_license_key).
 *   2. Authority-class gates run first -- if the operator has disabled the
 *      class or set a per-class rate limit, we reject BEFORE touching the
 *      destructive timestamp ring or the storeId allowlist.
 *   3. The destructive rate limit fires next, only when the call is
 *      destructive. Order matters: a class-disabled call should not
 *      contribute to the destructive count.
 *   4. checkStoreScopedToolInput runs last among the guardrails, so an
 *      allowlist miss surfaces a specific error rather than a generic
 *      class rejection.
 *
 * The MCP SDK validates `input` against `tool.inputSchema.shape` before
 * invoking this wrapper -- see `validateToolInput` in
 * @modelcontextprotocol/sdk/server/mcp.js, which runs safeParseAsync
 * against the registered schema and only calls the handler on success.
 * So by the time isDestructiveCall and checkStoreScopedToolInput run,
 * fields like `pause` / `status` / `storeId` are already type- and
 * shape-checked.
 */
export function createToolHandler<TInput = unknown>(
  tool: RegisterableTool<TInput>,
): (input: TInput) => Promise<McpToolResult> {
  return async (input) => {
    // The SDK validates against tool.inputSchema (a Zod object) before
    // calling this wrapper, so by the time we get here `input` is
    // guaranteed to be a plain object. The two casts below (input +
    // tool) bridge the generic TInput surface to the helper functions
    // in guardrails.ts, which keep their internal types narrow at
    // `Record<string, unknown>`. Callers of createToolHandler see only
    // the strict TInput surface.
    //
    // Defensive runtime check: if a future SDK change (or a direct
    // caller bypassing the SDK) hands us a non-object input, the
    // guardrail helpers would silently misbehave -- a string cast to
    // Record<string, unknown> has no `.storeId`, so the allowlist gate
    // and `isDestructive` predicate would both treat it as absent.
    // Return an isError MCP response (rather than throwing) so the
    // failure surfaces to the client without risking an uncaught
    // rejection that could destabilize the stdio server. Also log the
    // contract violation at error severity so an operator running with
    // LEMONSQUEEZY_LOG=error sees it.
    if (input === null || typeof input !== "object") {
      const contractError = `createToolHandler expected an object input for tool "${tool.name}", got ${input === null ? "null" : typeof input}. The MCP SDK should have rejected this before reaching the handler.`;
      logEvent({
        event: "tool_call",
        tool: tool.name,
        status: "exception",
        latency_ms: 0,
        error: contractError,
      });
      return {
        content: [{ type: "text" as const, text: `Error: ${contractError}` }],
        isError: true,
      };
    }
    const inputAsRecord = input as Record<string, unknown>;
    const toolAsRecord = tool as unknown as RegisterableTool<Record<string, unknown>>;
    const isDestructive = isDestructiveCall(toolAsRecord, inputAsRecord);
    const start = Date.now();
    try {
      checkClassAllowed(tool.authorityClass);
      checkClassRateLimit(tool.authorityClass);
      if (isDestructive) checkDestructiveRateLimit();
      checkStoreScopedToolInput(toolAsRecord, inputAsRecord);

      const response = await tool.handler(input);
      const latency_ms = Date.now() - start;
      // Inputs are logged ONLY for destructive calls. No destructive
      // tool today accepts a secret-typed input (webhook secret tools
      // are non-destructive), but redactSecrets() runs unconditionally
      // as defense-in-depth -- if a tool with secret-bearing inputs is
      // ever flipped to destructiveHint:true, the audit log won't leak.
      //
      // Hot-path note: the most common call is a non-destructive read at
      // LEMONSQUEEZY_LOG unset ("off"). Skip the entry literal in that case
      // so reads don't pay the allocation for an entry no consumer wants.
      // Destructive calls always build the entry because the audit-buffer
      // push is independent of the log level.
      const wouldLog = wouldLogToolCall({ isDestructive, isError: !response.ok });
      if (wouldLog || isDestructive) {
        const successEntry = {
          event: "tool_call" as const,
          tool: tool.name,
          status: response.ok ? ("ok" as const) : ("error" as const),
          latency_ms,
          request_id: response.requestId,
          error: response.ok ? undefined : response.error,
          audit: isDestructive ? true : undefined,
          inputs: isDestructive ? redactSecrets(input) : undefined,
        };
        if (wouldLog) logEvent(successEntry);
        if (isDestructive) {
          pushAuditEntry({ ts: new Date().toISOString(), ...successEntry });
        }
      }

      if (!response.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${response.error || "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }

      const text = JSON.stringify(response.data ?? { success: true }, null, 2);
      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const latency_ms = Date.now() - start;
      // Same wouldLog gate as the success branch -- at LEMONSQUEEZY_LOG=off
      // a non-destructive throw still skips the literal. (The audit-buffer
      // push is still required for destructive throws regardless.)
      const wouldLog = wouldLogToolCall({ isDestructive, isError: true });
      if (wouldLog || isDestructive) {
        const errorEntry = {
          event: "tool_call" as const,
          tool: tool.name,
          status: err instanceof GuardrailError ? ("guardrail_block" as const) : ("exception" as const),
          latency_ms,
          error: message,
          audit: isDestructive ? true : undefined,
          inputs: isDestructive ? redactSecrets(input) : undefined,
        };
        if (wouldLog) logEvent(errorEntry);
        if (isDestructive) {
          pushAuditEntry({ ts: new Date().toISOString(), ...errorEntry });
        }
      }
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  };
}

/**
 * Build the read-callback for the audit-log MCP Resource. Returns
 * application/x-ndjson, most-recent-first, one JSON object per line.
 * Empty buffer returns an empty-text content entry (no trailing newline).
 */
export function readAuditLogResource(uri: URL): {
  contents: { uri: string; mimeType: string; text: string }[];
} {
  const entries = readAuditEntries();
  const text = entries.map((e) => JSON.stringify(e)).join("\n");
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/x-ndjson",
        text,
      },
    ],
  };
}
