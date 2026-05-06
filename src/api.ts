/**
 * LemonSqueezy API client with Bearer token authentication.
 * Uses JSON:API format (application/vnd.api+json).
 */

import { z } from "zod";
import { logEvent } from "./logger.js";
import { fetchWithRetry, isAbortTimeoutError, REQUEST_TIMEOUT_MS } from "./retry.js";
import { invalidateApiKeyCache, loadApiKey } from "./secret.js";

const BASE_URL = "https://api.lemonsqueezy.com/v1";

/**
 * Shared schema for LemonSqueezy management-API resource IDs (stores,
 * customers, products, variants, prices, orders, subscriptions, license keys,
 * webhooks, etc). LemonSqueezy IDs are positive-integer strings; tightening at
 * the schema layer means an obvious typo fails fast with a useful error
 * before a request ever leaves the process.
 *
 * Not used for the License API tools (`ls_activate_license`, etc.), whose
 * `licenseKey` is a printable-key string and whose `instanceId` is a UUID --
 * those use plain `z.string()` validation.
 */
export const lsIdSchema = z
  .string()
  .max(10000)
  .regex(/^[1-9]\d*$/, "ID must be a positive integer string (e.g. '12345')");

/**
 * Encode a value for safe inclusion as a URL path segment. Always use this for
 * caller-supplied IDs interpolated into request paths, so a value like
 * "1/refund" cannot break out of the segment and target a different endpoint.
 */
export function encodePath(segment: unknown): string {
  return encodeURIComponent(String(segment));
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  requestId?: string;
}

/** Build query string from JSON:API params (include, filter, page). */
export function buildQuery(params?: {
  include?: string[];
  filter?: Record<string, string>;
  page?: { number?: number; size?: number };
}): string {
  if (!params) return "";

  const parts: string[] = [];

  if (params.include?.length) {
    parts.push(`include=${encodeURIComponent(params.include.map((s) => s.trim()).join(","))}`);
  }

  if (params.filter) {
    for (const [key, value] of Object.entries(params.filter)) {
      parts.push(`filter[${encodeURIComponent(key)}]=${encodeURIComponent(value)}`);
    }
  }

  if (params.page) {
    if (params.page.number !== undefined) {
      parts.push(`page[number]=${params.page.number}`);
    }
    if (params.page.size !== undefined) {
      parts.push(`page[size]=${params.page.size}`);
    }
  }

  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function decorateError(error: string, requestId: string | undefined): string {
  return requestId ? `${error} (request_id: ${requestId})` : error;
}

async function apiRequest<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
  const start = Date.now();
  const apiKey = await loadApiKey();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/vnd.api+json",
  };

  let fetchBody: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/vnd.api+json";
    fetchBody = JSON.stringify(body);
  }

  const url = `${BASE_URL}${path}`;
  // PATCH is excluded from the retry pool on purpose. JSON:API PATCH is
  // semantically idempotent (you're transitioning to a known target state),
  // but a transient 5xx mid-request leaves us unable to tell whether the
  // server applied the change or not, and replaying could double-bill on
  // anything that triggers proration. Treat only GET and DELETE as safe to
  // replay; PATCH and POST go through once.
  const idempotent = method === "GET" || method === "DELETE";

  let res: Response;
  try {
    res = await fetchWithRetry(url, { method, headers, body: fetchBody }, { idempotent });
  } catch (err) {
    const latency_ms = Date.now() - start;
    if (isAbortTimeoutError(err)) {
      const error = `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`;
      logEvent({ event: "http_call", method, path, status: "timeout", latency_ms, error });
      return { ok: false, status: 0, error };
    }
    const message = err instanceof Error ? err.message : String(err);
    logEvent({ event: "http_call", method, path, status: "network_error", latency_ms, error: message });
    throw err;
  }

  const latency_ms = Date.now() - start;
  const requestId = res.headers.get("x-request-id") ?? undefined;

  if (!res.ok) {
    // Auth failure most commonly means the API key was rotated upstream.
    // Bust the in-process cache so the next call re-fetches a fresh key
    // (from env or LEMONSQUEEZY_API_KEY_COMMAND) instead of waiting for the
    // 1h TTL to expire. We do NOT auto-retry the failed call here; the
    // caller still sees the 401/403 so a misconfigured key surfaces loudly.
    if (res.status === 401 || res.status === 403) {
      invalidateApiKeyCache();
    }
    const errorBody = await res.text();
    try {
      const parsed = JSON.parse(errorBody);
      const detail = (parsed as { errors?: Array<{ detail?: string }> }).errors?.[0]?.detail ?? errorBody;
      logEvent({
        event: "http_call",
        method,
        path,
        status: res.status,
        latency_ms,
        request_id: requestId,
        error: detail,
      });
      return {
        ok: false,
        status: res.status,
        data: parsed as T,
        error: decorateError(detail, requestId),
        requestId,
      };
    } catch {
      logEvent({
        event: "http_call",
        method,
        path,
        status: res.status,
        latency_ms,
        request_id: requestId,
        error: errorBody,
      });
      return {
        ok: false,
        status: res.status,
        error: decorateError(errorBody, requestId),
        requestId,
      };
    }
  }

  logEvent({
    event: "http_call",
    method,
    path,
    status: res.status,
    latency_ms,
    request_id: requestId,
  });

  if (res.status === 204) {
    return { ok: true, status: res.status, requestId };
  }

  // Read as text first so an empty or whitespace-only 2xx body (some
  // PATCH/POST endpoints can return 200 with no payload) doesn't blow up
  // `res.json()`. Malformed JSON on a 2xx is still a server bug and surfaces
  // as a thrown SyntaxError, which the registration wrapper in index.ts
  // catches as an `exception`.
  const bodyText = await res.text();
  const data = bodyText.trim() ? (JSON.parse(bodyText) as T) : undefined;
  return { ok: true, status: res.status, data, requestId };
}

/**
 * License API client — uses license key auth instead of API key.
 * Used for activate, validate, deactivate operations.
 */
export async function licenseRequest<T = unknown>(path: string, body: Record<string, string>): Promise<ApiResponse<T>> {
  const url = `${BASE_URL}${path}`;
  const start = Date.now();

  let res: Response;
  try {
    res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(body),
      },
      { idempotent: false },
    );
  } catch (err) {
    const latency_ms = Date.now() - start;
    if (isAbortTimeoutError(err)) {
      const error = `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`;
      logEvent({ event: "http_call", method: "POST", path, status: "timeout", latency_ms, error });
      return { ok: false, status: 0, error };
    }
    const message = err instanceof Error ? err.message : String(err);
    logEvent({
      event: "http_call",
      method: "POST",
      path,
      status: "network_error",
      latency_ms,
      error: message,
    });
    throw err;
  }

  const latency_ms = Date.now() - start;
  const requestId = res.headers.get("x-request-id") ?? undefined;

  if (!res.ok) {
    const errorBody = await res.text();
    try {
      const parsed = JSON.parse(errorBody);
      const p = parsed as { errors?: Array<{ detail?: string }>; error?: string };
      const detail = p.errors?.[0]?.detail ?? p.error ?? errorBody;
      logEvent({
        event: "http_call",
        method: "POST",
        path,
        status: res.status,
        latency_ms,
        request_id: requestId,
        error: detail,
      });
      return {
        ok: false,
        status: res.status,
        data: parsed as T,
        error: decorateError(detail, requestId),
        requestId,
      };
    } catch {
      logEvent({
        event: "http_call",
        method: "POST",
        path,
        status: res.status,
        latency_ms,
        request_id: requestId,
        error: errorBody,
      });
      return {
        ok: false,
        status: res.status,
        error: decorateError(errorBody, requestId),
        requestId,
      };
    }
  }

  logEvent({
    event: "http_call",
    method: "POST",
    path,
    status: res.status,
    latency_ms,
    request_id: requestId,
  });

  // Same defensive read as apiRequest -- empty or whitespace-only 2xx bodies
  // parse to undefined instead of throwing on `res.json()`.
  const bodyText = await res.text();
  const data = bodyText.trim() ? (JSON.parse(bodyText) as T) : undefined;
  return { ok: true, status: res.status, data, requestId };
}

/** Create a handler for GET /endpoint/:id with optional include. */
export function getHandler(endpoint: string, idField: string) {
  return async (input: Record<string, unknown>) => {
    const query = buildQuery({ include: (input.include as string | undefined)?.split(",") });
    return apiGet(`${endpoint}/${encodePath(input[idField])}${query}`);
  };
}

/** Create a handler for GET /endpoint with optional filters, include, and pagination. */
export function listHandler(endpoint: string, filterMap: Record<string, string> = {}) {
  return async (input: Record<string, unknown>) => {
    const filter: Record<string, string> = {};
    for (const [inputKey, apiKey] of Object.entries(filterMap)) {
      const val = input[inputKey];
      if (val !== undefined) filter[apiKey] = String(val);
    }
    const query = buildQuery({
      include: (input.include as string | undefined)?.split(","),
      filter,
      page: { number: input.pageNumber as number | undefined, size: input.pageSize as number | undefined },
    });
    return apiGet(`${endpoint}${query}`);
  };
}

export async function apiGet<T = unknown>(path: string): Promise<ApiResponse<T>> {
  return apiRequest<T>("GET", path);
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  return apiRequest<T>("POST", path, body);
}

export async function apiPatch<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  return apiRequest<T>("PATCH", path, body);
}

export async function apiDelete<T = unknown>(path: string): Promise<ApiResponse<T>> {
  return apiRequest<T>("DELETE", path);
}
