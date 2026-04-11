/**
 * LemonSqueezy API client with Bearer token authentication.
 * Uses JSON:API format (application/vnd.api+json).
 */

const BASE_URL = "https://api.lemonsqueezy.com/v1";
const REQUEST_TIMEOUT_MS = 30_000;

function getApiKey(): string {
  const key = process.env.LEMONSQUEEZY_API_KEY;
  if (!key) {
    throw new Error("LEMONSQUEEZY_API_KEY environment variable is required.");
  }
  if (key.trim() === "") {
    throw new Error("LEMONSQUEEZY_API_KEY is set but empty. Provide a valid API key.");
  }
  return key;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
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

async function apiRequest<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getApiKey()}`,
    Accept: "application/vnd.api+json",
  };

  let fetchBody: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/vnd.api+json";
    fetchBody = JSON.stringify(body);
  }

  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: fetchBody,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, status: 0, error: `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s` };
    }
    throw err;
  }

  if (!res.ok) {
    const errorBody = await res.text();
    try {
      const parsed = JSON.parse(errorBody);
      return { ok: false, status: res.status, data: parsed, error: parsed.errors?.[0]?.detail ?? errorBody };
    } catch {
      return { ok: false, status: res.status, error: errorBody };
    }
  }

  if (res.status === 204) {
    return { ok: true, status: res.status };
  }

  const data = (await res.json()) as T;
  return { ok: true, status: res.status, data };
}

/**
 * License API client — uses license key auth instead of API key.
 * Used for activate, validate, deactivate operations.
 */
export async function licenseRequest<T = unknown>(path: string, body: Record<string, string>): Promise<ApiResponse<T>> {
  const url = `${BASE_URL}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, status: 0, error: `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s` };
    }
    throw err;
  }

  if (!res.ok) {
    const errorBody = await res.text();
    try {
      const parsed = JSON.parse(errorBody);
      return {
        ok: false,
        status: res.status,
        data: parsed,
        error: parsed.errors?.[0]?.detail ?? parsed.error ?? errorBody,
      };
    } catch {
      return { ok: false, status: res.status, error: errorBody };
    }
  }

  const data = (await res.json()) as T;
  return { ok: true, status: res.status, data };
}

/** Create a handler for GET /endpoint/:id with optional include. */
export function getHandler(endpoint: string, idField: string) {
  return async (input: Record<string, unknown>) => {
    const query = buildQuery({ include: (input.include as string | undefined)?.split(",") });
    return apiGet(`${endpoint}/${input[idField]}${query}`);
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
