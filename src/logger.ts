export type LogEntry = {
  event: "tool_call" | "http_call";
  tool?: string;
  method?: string;
  path?: string;
  status?: number | string;
  latency_ms?: number;
  request_id?: string;
  error?: string;
  audit?: boolean;
  inputs?: unknown;
};

function isEnabled(): boolean {
  return process.env.LEMONSQUEEZY_LOG === "json";
}

export function logEvent(entry: LogEntry): void {
  if (!isEnabled()) return;
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    process.stderr.write(`${line}\n`);
  } catch {
    // Never let logging kill a request.
  }
}
