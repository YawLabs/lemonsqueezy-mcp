/**
 * Bridge tools for `@yawlabs/lemonsqueezy-webhook-sink`.
 *
 * The sink is an OPTIONAL long-running process that receives LemonSqueezy
 * webhooks and stores them for later reconciliation. These tools call into
 * the sink's admin HTTP surface so an agent can answer "which webhooks have
 * actually fired" alongside the management-API reads in the rest of this
 * package.
 *
 * The sink lives at a separate host (configured via env), uses bearer auth
 * via a separate token, and has its own JSON contract -- so we do NOT route
 * through `api.ts` (LemonSqueezy management API, JSON:API + LS bearer).
 * Plain `globalThis.fetch` + a 10s abort signal is enough for this surface.
 *
 * Design choices worth flagging:
 *
 *   * Tools are registered ALWAYS so they appear in `tools/list`. Missing
 *     env vars surface at CALL TIME as a `{ ok: false, error }` response,
 *     not as a registration-time failure. This matches the pattern used by
 *     every other handler in this package: the wrapper translates an
 *     `ok: false` into an `isError: true` MCP result without crashing the
 *     stdio loop.
 *
 *   * Env reads happen on every call (rather than once at server start) so
 *     an operator can rotate the admin token via `LEMONSQUEEZY_SINK_*` env
 *     mutation and pick up on the next call. Cost is a couple of property
 *     accesses per tool invocation.
 *
 *   * `LEMONSQUEEZY_SINK_URL` is stripped of trailing slash so callers that
 *     paste a URL with or without the slash get the same behavior.
 */

import { z } from "zod";
import type { ToolHandlerResponse } from "../wrapper.js";

const SINK_REPO_URL = "https://github.com/YawLabs/lemonsqueezy-webhook-sink";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

interface SinkConfig {
  url: string;
  token: string;
}

/**
 * Read sink env vars at call time. Returns either a usable config or a
 * `ToolHandlerResponse` describing exactly which env var is missing.
 *
 * Returning a `ToolHandlerResponse` from a helper (rather than throwing)
 * means the call-site can `return notConfigured` and the wrapper converts
 * it into an `isError: true` MCP result without a try/catch. Matches the
 * pattern used by other handlers in this package.
 */
function loadSinkConfig(): SinkConfig | ToolHandlerResponse {
  const rawUrl = process.env.LEMONSQUEEZY_SINK_URL;
  const token = process.env.LEMONSQUEEZY_SINK_ADMIN_TOKEN;
  if (!rawUrl || !token) {
    const missing: string[] = [];
    if (!rawUrl) missing.push("LEMONSQUEEZY_SINK_URL");
    if (!token) missing.push("LEMONSQUEEZY_SINK_ADMIN_TOKEN");
    return {
      ok: false,
      error: `Sink not configured: ${missing.join(", ")} must be set. See ${SINK_REPO_URL} for setup.`,
    };
  }
  return { url: rawUrl.replace(/\/+$/, ""), token };
}

function isToolHandlerResponse(value: SinkConfig | ToolHandlerResponse): value is ToolHandlerResponse {
  return "ok" in value;
}

/**
 * Build a path-plus-query string for the sink. Skips
 * undefined/null/empty entries so the resulting string never has trailing
 * `&` or `?` artifacts. Values are URL-encoded.
 */
function buildSinkPath(path: string, params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const s = String(v);
    if (s === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(s)}`);
  }
  const qs = parts.length > 0 ? `?${parts.join("&")}` : "";
  return `${path}${qs}`;
}

/**
 * Perform a sink HTTP request with a 10s abort timeout. Returns the
 * uniform `ToolHandlerResponse` shape so callers don't need their own
 * try/catch. Auth, network, timeout, and non-2xx all surface as
 * `{ ok: false, error }` -- the wrapper then renders that as an
 * `isError: true` MCP result.
 */
async function sinkRequest(
  config: SinkConfig,
  method: "GET" | "POST",
  pathAndQuery: string,
): Promise<ToolHandlerResponse> {
  const url = `${config.url}${pathAndQuery}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    // AbortSignal.timeout() rejects with a DOMException named "TimeoutError".
    // Other transport failures (DNS, refused, reset) surface as TypeError or
    // similar. Both land here and we collapse them to a single human-readable
    // message so the agent doesn't see "fetch failed" without context.
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || /timeout/i.test(message));
    return {
      ok: false,
      error: isTimeout
        ? `Sink request timed out after ${Math.round(FETCH_TIMEOUT_MS / 1000)}s (${config.url})`
        : `Sink unreachable: ${message} (${config.url})`,
    };
  }

  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore -- we'll fall through with empty body
    }
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) detail = parsed.error;
    } catch {
      // body was not JSON; keep as-is
    }
    if (res.status === 401) {
      return {
        ok: false,
        error: `Sink rejected admin token (401): ${detail || "unauthorized"}. Verify LEMONSQUEEZY_SINK_ADMIN_TOKEN matches the sink's WEBHOOK_SINK_ADMIN_TOKEN.`,
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        error: `Sink admin endpoint not found (404): ${detail || "not found"}. The sink may have been started without WEBHOOK_SINK_ADMIN_TOKEN set, which disables admin endpoints.`,
      };
    }
    return {
      ok: false,
      error: `Sink returned ${res.status}: ${detail || res.statusText}`,
    };
  }

  // 200 with empty body is unexpected for this contract, but degrade
  // gracefully rather than throwing on JSON.parse("").
  const text = await res.text();
  if (!text.trim()) return { ok: true, data: {} };
  if (text.length > MAX_BODY_SIZE_BYTES) {
    return {
      ok: false,
      error: `Sink response body too large: ${text.length} bytes exceeds ${MAX_BODY_SIZE_BYTES} byte limit`,
    };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Sink returned invalid JSON: ${message}` };
  }
}

export const sinkTools = [
  {
    name: "ls_sink_events_list",
    authorityClass: "read" as const,
    description:
      "List webhook events the sink has received, optionally filtered. Use `since` (received_at timestamp, exclusive) to checkpoint. Requires the sink at LEMONSQUEEZY_SINK_URL with LEMONSQUEEZY_SINK_ADMIN_TOKEN.",
    annotations: {
      title: "List sink webhook events",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      since: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Exclusive lower bound on received_at (Unix ms). Pass the highest received_at you have to checkpoint.",
        ),
      type: z.string().max(200).optional().describe("Filter by event_name (e.g. 'order_created')."),
      limit: z.number().int().min(1).max(1000).optional().describe("Maximum number of events to return."),
    }),
    handler: async (input: { since?: number; type?: string; limit?: number }): Promise<ToolHandlerResponse> => {
      const config = loadSinkConfig();
      if (isToolHandlerResponse(config)) return config;
      const path = buildSinkPath("/events", {
        since: input.since,
        type: input.type,
        limit: input.limit,
      });
      return sinkRequest(config, "GET", path);
    },
  },
  {
    name: "ls_sink_event_mark_processed",
    authorityClass: "mutate" as const,
    description: "Mark a sink event as processed by your consumer. Idempotent.",
    annotations: {
      title: "Mark sink event processed",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      id: z.number().int().min(1).describe("The sink event ID (positive integer, as returned by ls_sink_events_list)."),
    }),
    handler: async (input: { id: number }): Promise<ToolHandlerResponse> => {
      const config = loadSinkConfig();
      if (isToolHandlerResponse(config)) return config;
      return sinkRequest(config, "POST", `/events/${encodeURIComponent(String(input.id))}/processed`);
    },
  },
  {
    name: "ls_sink_stats",
    authorityClass: "read" as const,
    description: "Get sink totals: total events, unprocessed count, last-received timestamp.",
    annotations: {
      title: "Get sink stats",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({}),
    handler: async (): Promise<ToolHandlerResponse> => {
      const config = loadSinkConfig();
      if (isToolHandlerResponse(config)) return config;
      return sinkRequest(config, "GET", "/stats");
    },
  },
] as const;
