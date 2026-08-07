/**
 * LemonSqueezy API client with Bearer token authentication.
 * Uses JSON:API format (application/vnd.api+json).
 */

import { z } from "zod";
import { logEvent } from "./logger.js";
import { fetchWithRetry, isAbortTimeoutError, isRetryTimeoutError } from "./retry.js";
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
    // Drop empty/whitespace-only segments so `include: ""` (which Zod accepts
    // -- the schemas set .max() but no .min()) splits to [""] and produces no
    // param at all, rather than a bare `?include=` the API has to ignore.
    const segments = params.include.map((s) => s.trim()).filter(Boolean);
    if (segments.length > 0) {
      parts.push(`include=${encodeURIComponent(segments.join(","))}`);
    }
  }

  if (params.filter) {
    for (const [key, value] of Object.entries(params.filter)) {
      parts.push(`filter[${encodeURIComponent(key)}]=${encodeURIComponent(value)}`);
    }
  }

  if (params.page) {
    // encodeURIComponent matches the include/filter branches above. Today the
    // Zod schemas constrain both fields to integers so the encoding is a
    // no-op, but if pagination ever widens to accept a string cursor the
    // values are already safely escaped.
    if (params.page.number !== undefined) {
      parts.push(`page[number]=${encodeURIComponent(String(params.page.number))}`);
    }
    if (params.page.size !== undefined) {
      parts.push(`page[size]=${encodeURIComponent(String(params.page.size))}`);
    }
  }

  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function decorateError(error: string, requestId: string | undefined): string {
  return requestId ? `${error} (request_id: ${requestId})` : error;
}

/**
 * Union of the two error envelopes this package sees. The management API
 * (JSON:API) uses `errors[].detail`; the License API uses a bare `error`
 * string. Reading both in one helper lets `apiRequest` and `licenseRequest`
 * share the error path -- the management API never populates `error`, so
 * the extra fallback is inert there.
 */
type ErrorEnvelope = {
  errors?: Array<{ detail?: string; title?: string; status?: string }>;
  error?: string;
};

/**
 * Pull the most human-useful message out of an error envelope.
 *
 * Order matters. `detail` is the specific sentence ("Refund window closed") and
 * wins when present. `title` is the generic reason ("Not Found") and is what
 * LemonSqueezy actually sends on a 404 -- a real response looks like
 * `{"jsonapi":{...},"errors":[{"status":"404","title":"Not Found"}]}` with no
 * `detail` at all. Without the `title` arm that case fell all the way through
 * to the raw body, so the agent was handed a JSON blob instead of a reason.
 * `error` is the License API's bare-string form. Returns null when the envelope
 * carries nothing usable, so the caller can fall back to the raw text.
 */
function extractErrorMessage(parsed: ErrorEnvelope): string | null {
  const first = parsed.errors?.[0];
  return first?.detail ?? first?.title ?? parsed.error ?? null;
}

/**
 * Shared non-2xx handling for both API clients: read the body once, prefer a
 * structured error message over raw text, log at the http_call event, and
 * return the uniform ApiResponse failure shape.
 *
 * Extracted from the two near-identical blocks that previously lived in
 * `apiRequest` and `licenseRequest`. Callers keep their own auth-specific
 * side effects (e.g. the 401/403 key-cache bust) before calling in.
 */
async function handleErrorResponse<T>(
  res: Response,
  route: { method: string; path: string },
  latency_ms: number,
  requestId: string | undefined,
): Promise<ApiResponse<T>> {
  const errorBody = await res.text();
  try {
    const parsed = JSON.parse(errorBody) as ErrorEnvelope;
    const detail = extractErrorMessage(parsed) ?? errorBody;
    logEvent({
      event: "http_call",
      method: route.method,
      path: route.path,
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
      method: route.method,
      path: route.path,
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

/**
 * Read a 2xx body as text first so an empty or whitespace-only payload (some
 * PATCH/POST endpoints return 200 with no body) yields `undefined` instead of
 * blowing up `res.json()`. Malformed JSON on a 2xx is still a server bug and
 * surfaces as a thrown SyntaxError, which the registration wrapper catches as
 * an `exception`.
 */
async function readJsonBody<T>(res: Response): Promise<T | undefined> {
  const bodyText = await res.text();
  return bodyText.trim() ? (JSON.parse(bodyText) as T) : undefined;
}

/**
 * Format the user-facing timeout message. `fetchWithRetry` enriches its
 * thrown timeout with wall-clock `elapsedMs` and `attempts` so the message
 * reflects actual time spent across the retry loop, not just the
 * per-attempt budget. Falls back to the per-attempt value for any
 * unenriched timeout (defensive -- shouldn't happen via this codepath).
 *
 * Format is fixed and ASCII-only because it lands in stdio MCP terminal
 * output: `Request timed out after Xs (N attempts)`.
 */
function formatTimeoutMessage(err: unknown, fallbackElapsedMs: number): string {
  const plural = (n: number) => `${n} attempt${n === 1 ? "" : "s"}`;
  if (isRetryTimeoutError(err)) {
    const seconds = Math.max(1, Math.round(err.elapsedMs / 1000));
    return `Request timed out after ${seconds}s (${plural(err.attempts)})`;
  }
  const seconds = Math.max(1, Math.round(fallbackElapsedMs / 1000));
  return `Request timed out after ${seconds}s (${plural(1)})`;
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
  // `idempotent` gates the 5xx and network-error retry branches only.
  //
  // PATCH is excluded from that pool on purpose. JSON:API PATCH is
  // semantically idempotent (you're transitioning to a known target state),
  // but a transient 5xx mid-request leaves us unable to tell whether the
  // server applied the change or not, and replaying could double-bill on
  // anything that triggers proration. So for 5xx and network errors, only
  // GET and DELETE are replayed; PATCH and POST go through once.
  //
  // 429 is deliberately NOT gated by this flag -- see the retry-after branch
  // in `fetchWithRetry`. A 429 means the request was rejected before the
  // server acted on it, so replaying a POST (including a refund) after the
  // advertised Retry-After cannot double-apply. Every method is retried on
  // 429.
  const idempotent = method === "GET" || method === "DELETE";

  let res: Response;
  try {
    res = await fetchWithRetry(url, { method, headers, body: fetchBody }, { idempotent });
  } catch (err) {
    const latency_ms = Date.now() - start;
    if (isAbortTimeoutError(err)) {
      const error = formatTimeoutMessage(err, latency_ms);
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
    return handleErrorResponse<T>(res, { method, path }, latency_ms, requestId);
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

  return { ok: true, status: res.status, data: await readJsonBody<T>(res), requestId };
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
      const error = formatTimeoutMessage(err, latency_ms);
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
    // No key-cache bust here: the License API authenticates with the license
    // key from the caller's input, not the LEMONSQUEEZY_API_KEY the cache holds.
    return handleErrorResponse<T>(res, { method: "POST", path }, latency_ms, requestId);
  }

  logEvent({
    event: "http_call",
    method: "POST",
    path,
    status: res.status,
    latency_ms,
    request_id: requestId,
  });

  return { ok: true, status: res.status, data: await readJsonBody<T>(res), requestId };
}

/** Create a handler for GET /endpoint/:id with optional include. */
export function getHandler(endpoint: string, idField: string) {
  return async (input: Record<string, unknown>) => {
    const query = buildQuery({ include: (input.include as string | undefined)?.split(",") });
    return apiGet(`${endpoint}/${encodePath(input[idField])}${query}`);
  };
}

/**
 * Async handler with the originating filterMap attached so callers (and
 * `tools.test.ts`) can introspect the input-key -> filter-key mapping
 * without re-parsing the source. Load-bearing for the allowlist-alignment
 * invariant in `tools.test.ts` -- the wrapper's storeId allowlist gate
 * keys off the input field name `storeId`, so any list tool that maps a
 * different input field to filter[store_id] would silently bypass it.
 */
export type ListHandler = ((input: Record<string, unknown>) => Promise<ApiResponse>) & {
  filterMap: Readonly<Record<string, string>>;
};

/** Create a handler for GET /endpoint with optional filters, include, and pagination. */
export function listHandler(endpoint: string, filterMap: Record<string, string> = {}): ListHandler {
  const handler = async (input: Record<string, unknown>): Promise<ApiResponse> => {
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
  return Object.assign(handler, { filterMap });
}

/**
 * Input-key -> API-key mapping for the invoice-detail query params shared by
 * `ls_generate_order_invoice` and `ls_generate_subscription_invoice`. Both
 * endpoints take the same eight fields on the query string, not in a body.
 * Declaration order is the emitted param order.
 */
const INVOICE_FIELD_MAP = {
  name: "name",
  address: "address",
  city: "city",
  state: "state",
  zipCode: "zip_code",
  country: "country",
  notes: "notes",
  locale: "locale",
} as const;

export type InvoiceDetails = Partial<Record<keyof typeof INVOICE_FIELD_MAP, string>>;

/**
 * Build the `?name=...&zip_code=...` query string for the two generate-invoice
 * endpoints. Returns "" when no invoice details were supplied, so callers can
 * append it unconditionally.
 */
export function buildInvoiceQuery(input: InvoiceDetails): string {
  const params = new URLSearchParams();
  for (const [inputKey, apiKey] of Object.entries(INVOICE_FIELD_MAP)) {
    const value = input[inputKey as keyof InvoiceDetails];
    if (value !== undefined) params.set(apiKey, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// ─── Cross-store disclosure notes (appended to list-tool descriptions) ───
//
// LEMONSQUEEZY_ALLOWED_STORE_IDS cannot fully scope a list endpoint that has
// no storeId field -- see the header comment in `guardrails.ts`. These two
// helpers keep the disclosure identical across every affected tool so a
// reworded copy in one file can't drift from the rest.

const CROSS_STORE_TRAILER =
  "Pair with a scoped LemonSqueezy API key for true cross-store enforcement -- the API key's visibility is the true boundary.";

/**
 * Disclosure for a list tool that declares `requiredFilters`: the allowlist
 * forces a parent-ID filter, but that parent can still belong to a
 * non-allowed store.
 */
export function crossStoreFilterNote(filters: readonly string[]): string {
  return `Cross-store note: when LEMONSQUEEZY_ALLOWED_STORE_IDS is set, this tool requires at least one of: ${filters.join(", ")}. Even with that set, ${CROSS_STORE_TRAILER}`;
}

/**
 * Disclosure for a list tool the allowlist cannot gate at all -- no storeId
 * field and no parent ID to scope by (`ls_list_stores`, `ls_list_affiliates`).
 * `returns` describes what leaks, e.g. "every store the API key can see".
 */
export function crossStoreUngatedNote(returns: string): string {
  return `Cross-store note: LEMONSQUEEZY_ALLOWED_STORE_IDS does NOT gate this tool -- it has no storeId field and no parent ID filter to scope by, so it returns ${returns}. ${CROSS_STORE_TRAILER}`;
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
