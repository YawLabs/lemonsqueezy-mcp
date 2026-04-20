# Changelog

All notable changes to `@yawlabs/lemonsqueezy-mcp` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versioning follows [SEMVER.md](./SEMVER.md).

## [Unreleased]

## [0.4.1] — 2026-04-20

### Security

- Override transitive `hono` to `^4.12.14` to clear Dependabot advisory on `hono/jsx` SSR. Not exploitable in this package (MCP does not use `hono/jsx`), but closes the supply-chain scan signal.

### Docs

- README links to `@yawlabs/lemonsqueezy-webhook-sink` from the webhook-reconciliation callout.

## [0.4.0] — 2026-04-20

Hardening pass for unattended automation against live billing flows.

### Added

- **Guardrails.** Opt-in controls evaluated in a single dispatcher pre-check:
  - `LEMONSQUEEZY_ALLOWED_STORE_IDS` — allowlist enforced on every tool call that names a store.
  - `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` — per-call cap on `ls_refund_order` to prevent runaway agents from issuing large refunds.
  - `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` — rolling 60-second circuit breaker on destructive tool calls.
  All three default to unset → disabled, so existing integrations are unaffected until explicitly opted in.
- **Retry layer** (`src/retry.ts`). Exponential backoff with jitter, capped at 4 attempts and 30s. Retries `429` always (honors `Retry-After`), `5xx` and transport errors only on idempotent methods (`GET`/`DELETE`). Non-idempotent writes fail fast.
- **Secret loader** (`src/secret.ts`). `LEMONSQUEEZY_API_KEY_COMMAND` invokes an external command (vault CLI, 1Password, etc.) and caches the result for 1 hour. Lets credentials rotate without restarting the server.
- **Structured logger** (`src/logger.ts`). Opt-in via `LEMONSQUEEZY_LOG=json`. Emits JSON lines to stderr (stdout stays reserved for MCP protocol). Destructive tool calls are tagged `audit: true` with redacted inputs.
- **Request ID surfacing.** API error messages include upstream `X-Request-Id` when present, so support tickets can be traced.
- **Read-only integration tests.** `npm run test:integration` hits a live LemonSqueezy store if `LEMONSQUEEZY_TEST_API_KEY` + `LEMONSQUEEZY_TEST_STORE_ID` are set; skips gracefully otherwise. Exercises `ls_get_user`, `ls_get_store`, `ls_list_products`, `ls_list_variants`, `ls_list_orders`, `ls_list_subscriptions`, and 404 error paths. Runs nightly via `.github/workflows/integration.yml`.
- **`SEMVER.md`** — documents what counts as a breaking change for this package (tool names, required inputs, return shapes), and what explicitly does not (upstream API drift, internal module names).

### Changed

- Input validation on every tool: `z.string()` fields capped at 10,000 chars, `.email()` fields capped at 320 chars. Protects against accidental DoS via oversized payloads.

### Fixed

- `parseRetryAfterMs` now correctly falls back to the default 1s when given a negative number like `"-3"` (previously `Date.parse("-3")` returned a finite value and produced a non-sensical delay).
- Retry policy no longer retries `5xx` on `POST`/`PATCH`/`PUT` — prevents duplicate writes if a timeout is actually a slow success.

## [0.3.0] — 2026-04-18

### Added

- Affiliate tools (`ls_list_affiliates`, `ls_get_affiliate`).
- `429` retry with exponential backoff in the API client.
- `SECURITY.md` — vulnerability disclosure policy.
- `CONTRIBUTING.md` — contributor and AI-agent guidelines.

## [0.2.1] — 2026-04-16

### Changed

- Deduplicated tool handler boilerplate across tool files.

### Fixed

- API error handling surfaces upstream error bodies correctly.

### Added

- Error-path tests for every tool.

## [0.2.0] — 2026-04-14

### Added

- Input validation via Zod `.describe()` on every tool input field.

### Fixed

- `ls_generate_order_invoice` and `ls_generate_subscription_invoice` now hit the correct endpoints and handle the async invoice-generation response shape.

## [0.1.1] — 2026-04-12

### Added

- Edge-case handler tests for fuller coverage across all 59 tools.

## [0.1.0] — 2026-04-11

Initial release. 59 tools covering all 17 LemonSqueezy API resources.

[Unreleased]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/YawLabs/lemonsqueezy-mcp/releases/tag/v0.1.0
