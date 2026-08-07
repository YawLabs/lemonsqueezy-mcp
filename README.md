# @yawlabs/lemonsqueezy-mcp

MCP server for the [LemonSqueezy](https://lemonsqueezy.com) API. Manage your store, products, customers, subscriptions, discounts, license keys, and more from any MCP-compatible AI assistant.

[![Add to Yaw MCP](https://yaw.sh/yaw-mcp-button.svg)](https://yaw.sh/mcp/install?name=LemonSqueezy&command=npx&args=-y%2C%40yawlabs%2Flemonsqueezy-mcp&description=LemonSqueezy%20store%20management%20-%20products%2C%20orders%2C%20subscriptions%2C%20license%20keys&source=https%3A%2F%2Fgithub.com%2FYawLabs%2Flemonsqueezy-mcp)

One click adds this to your local Yaw MCP config so it's available in every Yaw Terminal session. Or install manually below.

## Quick start

```bash
npx -y @yawlabs/lemonsqueezy-mcp@latest
```

Or one-click install via Smithery:

```bash
npx -y @smithery/cli install @yawlabs/lemonsqueezy-mcp --client claude
```

Smithery prompts for your env vars (API key, optional guardrails) and writes the config into your client for you.

## What it looks like

Once configured, you can ask your AI assistant store-management questions in plain English and it routes them through the MCP tools:

```
You:  How much did we make from the "Pro Annual" plan last month?
Claude: [calls ls_list_subscriptions, ls_get_variant, ls_list_subscription_invoices]
        Pro Annual brought in $14,280 across 84 active subscriptions in April.
        Three of those were upgrades from monthly; none churned.

You:  Refund order #LS-1234 in full.
Claude: [calls ls_get_order to fetch the total, then ls_refund_order with amount = total]
        Refunded $99.00 against order LS-1234. The customer's card will see the
        credit in 5-10 business days.

You:  Disable license key abc-123 for the customer who reported abuse.
Claude: [calls ls_list_license_keys to find the ID, then ls_update_license_key with disabled: true]
        License key disabled. Their existing activations will fail validation
        on the next check.
```

Guardrails (refund cap, rate limit, store allowlist) catch the obvious mistakes before they reach LemonSqueezy. See [Configuration](#configuration) for the env vars that turn them on.

## Setup

Set your LemonSqueezy API key as an environment variable:

```bash
export LEMONSQUEEZY_API_KEY="your-api-key"
```

Get your API key from your [LemonSqueezy dashboard](https://app.lemonsqueezy.com/settings/api).

### Docker

A multi-stage `Dockerfile` is included at the repo root. The runtime image is a single bundled file on `node:20-alpine` running as the non-root `node` user, with no port exposed (stdio transport).

```bash
docker build -t yawlabs/lemonsqueezy-mcp .
docker run --rm -i -e LEMONSQUEEZY_API_KEY="your-api-key" yawlabs/lemonsqueezy-mcp
```

A matching `Containerfile` is provided for Podman users. It is generated from `Dockerfile` via `npm run gen:containerfile`; CI calls `npm run check:containerfile` so a divergent edit fails review rather than drifting silently.

### Claude Code

Add to your MCP config:

```json
{
  "mcpServers": {
    "lemonsqueezy": {
      "command": "npx",
      "args": ["-y", "@yawlabs/lemonsqueezy-mcp@latest"],
      "env": {
        "LEMONSQUEEZY_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lemonsqueezy": {
      "command": "npx",
      "args": ["-y", "@yawlabs/lemonsqueezy-mcp@latest"],
      "env": {
        "LEMONSQUEEZY_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Tools (64)

### Users
- `ls_get_user` — Get the authenticated user

### Stores
- `ls_get_store` — Get a store by ID
- `ls_list_stores` — List all stores

### Customers
- `ls_get_customer` — Get a customer by ID
- `ls_list_customers` — List customers (filter by store, email)
- `ls_create_customer` — Create a customer
- `ls_update_customer` — Update a customer
- `ls_archive_customer` — Archive a customer

### Products
- `ls_get_product` — Get a product by ID
- `ls_list_products` — List products (filter by store)

### Variants
- `ls_get_variant` — Get a variant by ID
- `ls_list_variants` — List variants (filter by product)

### Prices
- `ls_get_price` — Get a price by ID
- `ls_list_prices` — List prices (filter by variant)

### Files
- `ls_get_file` — Get a file by ID
- `ls_list_files` — List files (filter by variant)

### Orders
- `ls_get_order` — Get an order by ID
- `ls_list_orders` — List orders (filter by store, email)
- `ls_generate_order_invoice` — Generate a PDF invoice
- `ls_refund_order` — Issue a refund

### Order Items
- `ls_get_order_item` — Get an order item by ID
- `ls_list_order_items` — List order items (filter by order, product, variant)

### Subscriptions
- `ls_get_subscription` — Get a subscription by ID
- `ls_list_subscriptions` — List subscriptions (filter by store, status, product, etc.)
- `ls_update_subscription` — Update (plan switch, pause, billing anchor, trial)
- `ls_cancel_subscription` — Cancel a subscription

### Subscription Invoices
- `ls_get_subscription_invoice` — Get a subscription invoice by ID
- `ls_list_subscription_invoices` — List subscription invoices (filter by store, subscription, status)
- `ls_generate_subscription_invoice` — Generate a PDF invoice
- `ls_refund_subscription_invoice` — Issue a refund

### Subscription Items
- `ls_get_subscription_item` — Get a subscription item by ID
- `ls_list_subscription_items` — List subscription items (filter by subscription, price)
- `ls_update_subscription_item` — Update quantity
- `ls_get_subscription_item_usage` — Get current billing period usage

### Usage Records
- `ls_get_usage_record` — Get a usage record by ID
- `ls_list_usage_records` — List usage records (filter by subscription item)
- `ls_create_usage_record` — Report metered usage (increment or set)

### Discounts
- `ls_get_discount` — Get a discount by ID
- `ls_list_discounts` — List discounts (filter by store)
- `ls_create_discount` — Create a discount code
- `ls_delete_discount` — Delete a discount

### Discount Redemptions
- `ls_get_discount_redemption` — Get a discount redemption by ID
- `ls_list_discount_redemptions` — List redemptions (filter by discount, order)

### License Keys
- `ls_get_license_key` — Get a license key by ID
- `ls_list_license_keys` — List license keys (filter by store, order, product)
- `ls_update_license_key` — Update activation limit, expiry, or disabled status

### License Key Instances
- `ls_get_license_key_instance` — Get a license key activation by ID
- `ls_list_license_key_instances` — List activations (filter by license key)

### Checkouts
- `ls_get_checkout` — Get a checkout by ID
- `ls_list_checkouts` — List checkouts (filter by store, variant)
- `ls_create_checkout` — Create a checkout URL (custom pricing, prefill, discounts)

### Webhooks
- `ls_get_webhook` — Get a webhook by ID
- `ls_list_webhooks` — List webhooks (filter by store)
- `ls_create_webhook` — Create a webhook
- `ls_update_webhook` — Update a webhook
- `ls_delete_webhook` — Delete a webhook

### License API
- `ls_activate_license` — Activate a license key (no API key required)
- `ls_validate_license` — Validate a license key (no API key required)
- `ls_deactivate_license` — Deactivate a license key instance (no API key required)

### Webhook sink (optional)
Bridge to a separate [@yawlabs/lemonsqueezy-webhook-sink](https://github.com/YawLabs/lemonsqueezy-webhook-sink) process so the agent can reconcile against webhooks that actually fired. Tools are always registered; if `LEMONSQUEEZY_SINK_URL` / `LEMONSQUEEZY_SINK_ADMIN_TOKEN` are unset, calls return a clear "not configured" error.

- `ls_sink_events_list` — List webhook events the sink has received (filter by `since` / `type` / `limit`)
- `ls_sink_event_mark_processed` — Mark a sink event as processed by your consumer (idempotent)
- `ls_sink_stats` — Get total events, unprocessed count, and last-received timestamp

## Features

- **Full API coverage** — All 17 LemonSqueezy API resources with 61 tools, plus 3 bridge tools to an optional [@yawlabs/lemonsqueezy-webhook-sink](https://github.com/YawLabs/lemonsqueezy-webhook-sink) for webhook reconciliation
- **JSON:API support** — Filtering, pagination, and relationship inclusion on all list/get operations
- **Zero runtime dependencies** — Single bundled file for instant `npx` startup
- **License API** — Activate, validate, and deactivate license keys without an API key
- **MCP annotations** — Every tool declares read-only, destructive, and idempotent hints
- **Retry with backoff** — 429 and 5xx retries (idempotent methods only) with exponential backoff, jitter, and a 90s overall-deadline ceiling
- **Guardrails** — opt-in store allowlist, refund cap, destructive-call rate limit, authority-class disable (`LEMONSQUEEZY_DISABLE_CLASSES`), and per-authority-class rate limits (`LEMONSQUEEZY_RATE_LIMIT_PER_CLASS`)
- **Audit log MCP Resource** — `lemonsqueezy://audit-log` exposes the last 1000 destructive-call entries as `application/x-ndjson` for clients without stderr access
- **Structured logging** — opt-in JSON logs to stderr with selectable levels (`error`, `audit`, `all`)

## Configuration

All configuration is via environment variables. Only `LEMONSQUEEZY_API_KEY` (or `LEMONSQUEEZY_API_KEY_COMMAND`) is required; everything else is opt-in.

| Variable | Purpose |
| --- | --- |
| `LEMONSQUEEZY_API_KEY` | LemonSqueezy API token. |
| `LEMONSQUEEZY_API_KEY_COMMAND` | Command whose stdout produces the API key. Overrides `LEMONSQUEEZY_API_KEY`. Output is cached for 1 hour. Use this to pull short-lived credentials from a vault (`op read`, `gcloud secrets versions access`, etc.) without writing them to env vars. The cache is keyed by the command string, so changing it mid-process refreshes on the next request; it is also invalidated automatically on a 401/403 from the API, so a key rotated upstream takes effect on the next call without waiting for the TTL. |
| `LEMONSQUEEZY_TEST_API_KEY` | Optional test-mode key. When set and non-empty, it takes precedence over `LEMONSQUEEZY_API_KEY` (but not over `LEMONSQUEEZY_API_KEY_COMMAND`). On first activation per process, the server prints a one-line JSON `test_mode` notice to stderr so you can confirm test mode is engaged. Use this to point the server at a sandbox/test store without unsetting your production key. |
| `LEMONSQUEEZY_ALLOWED_STORE_IDS` | Comma-separated allowlist of store IDs. When set: (1) any tool whose input includes a `storeId` rejects calls to a non-allowed store; (2) tools that *accept* a `storeId` filter (e.g. `ls_list_orders`, `ls_list_subscriptions`) require it — calls without one are blocked so a missing filter cannot return data from every store the API key can see. Tools with no `storeId` field at all are **not** gated by this allowlist, in two distinct shapes: (a) ID-targeted tools (`ls_refund_order`, `ls_cancel_subscription`, `ls_archive_customer`, `ls_delete_webhook`, `ls_delete_discount`, `ls_update_license_key`) route by their own resource ID, so the caller must already know the ID; (b) `ls_list_stores` and `ls_list_affiliates` take no scoping ID at all and **return rows from every store the API key can see** — `ls_list_stores` will enumerate stores outside the allowlist. Both say so in their own tool descriptions. Other list-by-parent tools (`ls_list_prices`, `ls_list_files`, `ls_list_variants`, `ls_list_order_items`, `ls_list_discount_redemptions`, `ls_list_license_key_instances`, `ls_list_subscription_items`, `ls_list_usage_records`) require a parent-ID filter when the allowlist is set — a partial mitigation, since that parent can itself belong to a non-allowed store. LemonSqueezy API keys are issued at the account level and authorize access to every store in that account, so this allowlist is the only in-process store boundary the server can enforce. Pair it with `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` / `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` / `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS` for defense in depth, and — if your account hosts multiple stores you don't want exposed to the same agent — keep those stores under a separate LemonSqueezy account whose API key isn't reachable from this server. |
| `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` | Non-negative integer. Rejects `ls_refund_order` and `ls_refund_subscription_invoice` calls above this amount. Unset or empty means no cap; **`0` is a valid value and blocks every refund** (the schemas require `amount >= 1`), so use it as a kill switch. The check runs *before* the rate limiters, so a rejected over-cap refund does not consume your destructive or `money`-class budget. |
| `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` | Non-negative integer. Max destructive tool calls per 60-second rolling window. Unset or empty means no limit; **`0` blocks every destructive call.** In-process limit — per MCP server instance, not global; each `npx` cold start resets the window. Counts include every refund, cancellation, archive, and delete tool, plus the input-dependent destructive paths: `ls_update_license_key` calls that set `disabled: true` *or* change `activationLimit`, `ls_update_subscription` calls that pause or switch plan, and `ls_update_customer` calls with `status: "archived"`. |
| `LEMONSQUEEZY_DISABLE_CLASSES` | Comma-separated list of [authority classes](#authority-classes) to refuse outright. Any tool whose class is listed returns a `guardrail_block` before the API call is attempted. Example: `LEMONSQUEEZY_DISABLE_CLASSES=money,recurring,pii` lets an agent run reads but blocks refunds, subscription changes, and customer-record access. Unknown class names throw at server startup. |
| `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS` | Per-class rolling rate limits, comma-separated. Each entry is `class:N`, `class:N/m`, or `class:N/h` (bare numbers default to per-minute). Example: `money:2/h,recurring:5/h,key:10/m`. Composes with `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` — both must pass. A limit of `0` blocks every call in that class; classes you don't list are unlimited. Malformed entries throw at server startup. In-process per server instance. |
| `LEMONSQUEEZY_LOG` | Structured-log verbosity to stderr. Set to `all` (or legacy `json`) to log every tool and HTTP call, `audit` to log only destructive-call audit entries plus errors (recommended for production), `error` to log only failures. Unset: no logs. Destructive calls are tagged `audit: true` and include their inputs. Failure entries carry a `status` that identifies the cause: `guardrail_block` (operator policy refused the call), `validation_error` (the client sent a malformed request, e.g. an update with no fields to change), `exception` (something faulted), plus `timeout` / `network_error` and raw HTTP status codes. |
| `LEMONSQUEEZY_SINK_URL` | Base URL of an optional [@yawlabs/lemonsqueezy-webhook-sink](https://github.com/YawLabs/lemonsqueezy-webhook-sink) instance (e.g. `https://webhooks.example.com`). Trailing slashes are stripped. Enables the `ls_sink_*` reconciliation tools below. Unset: the tools are still registered but return a "not configured" error when called. |
| `LEMONSQUEEZY_SINK_ADMIN_TOKEN` | Bearer token for the sink's admin endpoints. Must match the sink's `WEBHOOK_SINK_ADMIN_TOKEN`. Required when `LEMONSQUEEZY_SINK_URL` is set; if the sink itself was started without an admin token, its admin endpoints return 404 and `ls_sink_*` calls surface that diagnostically. |

### Logging format

Each line: `{ts, event, tool?, method?, path?, status, latency_ms, request_id?, error?, audit?, inputs?}`. Stdout is reserved for the MCP protocol — never log there.

### Error decoration

HTTP errors include the upstream `X-Request-Id` when present, so support tickets to LemonSqueezy can reference the exact call.

## Authority classes

**The strongest access control LemonSqueezy itself exposes is the API key boundary.** A LemonSqueezy API key authorizes its full account — every store, every tool — and the only way to deny a class of authority through LemonSqueezy is to not give the API key to the agent in the first place. LemonSqueezy's team-membership UI scopes which humans can do which actions in the dashboard, but the public API key inherits the full authority of the account it was issued under; there's no "this key can read but not refund" toggle. So the authoritative boundary, as far as the upstream API is concerned, is *which API key the agent has*.

That means the env vars below are the primary in-process control surface for anything LemonSqueezy can't gate by itself — per-class rate ceilings (`RATE_LIMIT_PER_CLASS`), deploy-time class disables (`DISABLE_CLASSES`), refund caps (`MAX_REFUND_AMOUNT_CENTS`), and the audit log. They are belt-and-braces in the sense that an operator who can change the server's env can remove them; they are load-bearing in the sense that LemonSqueezy has no equivalent. If you need an agent that genuinely cannot reach a store or a class of action, the durable answer is a separate LemonSqueezy account whose key is never handed to that agent.

Every tool is tagged with an **authority class** — a label for the kind of business authority a caller needs to invoke it. The class is separate from the binary destructive/read-only annotation: a customer-record read and a product list are both reads, but only one returns PII; a checkout creation and a refund are both writes, but only one moves money.

| Class | What it covers | Example tools |
| --- | --- | --- |
| `read` | Safe reads (list/get) that don't return customer PII as the primary payload. | `ls_list_orders`, `ls_get_product`, `ls_validate_license` |
| `pii` | Reads or writes whose primary payload is a customer record. | `ls_list_customers`, `ls_create_customer`, `ls_archive_customer` |
| `mutate` | Safe mutations: checkouts, discounts, invoice generation, usage records. | `ls_create_checkout`, `ls_create_discount`, `ls_generate_order_invoice` |
| `money` | Money movement. Irreversible at the payment layer. | `ls_refund_order`, `ls_refund_subscription_invoice` |
| `recurring` | Subscription state changes that affect recurring revenue. | `ls_update_subscription`, `ls_cancel_subscription`, `ls_update_subscription_item` |
| `key` | License-key admin (activate, deactivate, disable, change activation limit). | `ls_update_license_key`, `ls_activate_license`, `ls_deactivate_license` |
| `webhook` | Webhook configuration — affects the trust surface other systems rely on. | `ls_create_webhook`, `ls_update_webhook`, `ls_delete_webhook` |

Note: `ls_get_order` returns customer fields incidentally, but its primary payload is the order — it stays in `read`, not `pii`. The class is reserved for tools whose *primary purpose* is the customer record. If you need to deny all access to customer-shaped data, set `LEMONSQUEEZY_DISABLE_CLASSES=pii` and — if the agent must never under any circumstances touch that data — also issue its API key from a separate LemonSqueezy account that doesn't host customer records you care about.

The two opt-in env vars that consume this taxonomy:

- `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS` — caps the call rate per class. LemonSqueezy permissions cannot express "max 2 refunds per hour"; this is the only place that policy can live. **This is the load-bearing one for runaway-agent prevention.**
- `LEMONSQUEEZY_DISABLE_CLASSES` — blocks a class outright. Useful when fast deploy-time toggles matter — flipping `DISABLE_CLASSES=pii,mutate,money,recurring,key,webhook` to lock an analytics deployment into pure reads is a one-line config change. An operator who can change the server's env can also remove this gate, so for an authoritative deny use a separate LemonSqueezy account whose API key the agent never sees.

Both are opt-in; with neither set, behavior is unchanged from prior versions.

## Resources

The server exposes one MCP Resource for clients that prefer structural retrieval over parsing stderr:

| URI | MIME type | Contents |
| --- | --- | --- |
| `lemonsqueezy://audit-log` | `application/x-ndjson` | The most recent destructive tool calls and outcomes (rate-limit blocks, refund-cap blocks, exceptions, successes). Bounded ring buffer of the last 1000 entries, most-recent-first, resets on server restart. Redaction runs on the input payload before it reaches the buffer: any object key whose name matches a credential / PII pattern (`secret`, `password`, `token`, `api_key`, `bearer`, `authorization`, `signing_secret`, `private_key`, `pin`, `ssn`, `social_security_number`, `credit_card`, `card_number`, `cvv`, `cvc` — case-insensitive, whole-word) AND any string value matching the JWT bearer-token shape (`eyJ…`-prefixed, three base64url segments) is replaced with `[REDACTED]`. Ordinary identifiers (`licenseKey`, `instanceId`, `storeId`, `orderId`, `webhookId`) and UUID-shaped values are preserved. |

## Operating the server unattended

For unattended/agentic use against a live store, we recommend:

1. Issue an API key under a LemonSqueezy account that hosts only the store(s) the agent is allowed to touch — LemonSqueezy doesn't expose per-store API-key scoping, so account separation is the durable store boundary. Set `LEMONSQUEEZY_ALLOWED_STORE_IDS` to the same set as a belt-and-braces in-process gate on the tools that take a `storeId`.
2. Set `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` to a per-call cap well below any single-refund expectation.
3. Set `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` to a small number (e.g. 5/min) as a runaway-agent circuit breaker. For finer control, add `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS=money:2/h,recurring:5/h,key:10/m` so each [authority class](#authority-classes) has its own ceiling.
4. If a class shouldn't be reachable at all (e.g. an analytics agent that needs only `read`), set `LEMONSQUEEZY_DISABLE_CLASSES` to the classes you want refused. The server rejects them before the API call is built. For an irrevocable deny, also issue the agent's API key from a separate LemonSqueezy account.
5. Set `LEMONSQUEEZY_LOG=audit` and ship stderr to your log aggregator. The `audit` level keeps every destructive-call entry plus errors but drops successful reads so log volume stays bounded over weeks of operation. Alert on `status: "guardrail_block"` or elevated error rates per tool. Use `LEMONSQUEEZY_LOG=all` while debugging.
6. Run `LEMONSQUEEZY_API_KEY_COMMAND` against a vault-backed secret so credentials can rotate without restarting the server process. The API client invalidates its in-process key cache automatically on a 401/403, so a rotated upstream key picks up on the next request rather than waiting on the 1h TTL.

What the server does **not** do and you must own at the caller level:

- **Idempotency / dedupe store** — MCP servers are stateless subprocesses; cross-invocation dedupe belongs in your agent or orchestrator.
- **Webhook reconciliation** — subscribe to LemonSqueezy webhooks in a separate long-running process to reconcile state when API writes succeed but the response is lost. See [@yawlabs/lemonsqueezy-webhook-sink](https://github.com/YawLabs/lemonsqueezy-webhook-sink) for a ready-made sink.
- **Metrics / dashboards** — the server emits structured logs; derive metrics in your log pipeline.

See [SEMVER.md](./SEMVER.md) for the versioning policy.

## Development

```bash
npm install
npm run lint
npm test                  # full unit + handler suite
npm run test:integration  # requires LEMONSQUEEZY_TEST_API_KEY + LEMONSQUEEZY_TEST_STORE_ID
```

`Containerfile` is generated from `Dockerfile`. After editing `Dockerfile`:

```bash
npm run gen:containerfile    # regenerate Containerfile
npm run check:containerfile  # CI runs this; non-zero exit means the two have drifted
```

## Running on oam.js (optional)

[oam.js](https://oamjs.org) runs this server unmodified. Verified against oam 0.8.2: full MCP handshake, all 64 tools, the `lemonsqueezy://audit-log` resource, working `fetch`, and guardrail rejections with error text identical to Node.

```jsonc
{
  "mcpServers": {
    "lemonsqueezy": {
      "command": "oam",
      "args": ["run", "/path/to/lemonsqueezy-mcp/dist/index.js"],
      "env": { "LEMONSQUEEZY_API_KEY": "..." }
    }
  }
}
```

Note the `--` separator if you pass arguments to the server rather than to oam: `oam run dist/index.js -- version`.

**Node stays the default, deliberately.** An MCP client cold-starts this server once per session, so startup is the cost that actually gets paid — and on the machine this was measured on, Node won: **196ms median against 424ms for `oam run`** (8 runs each, `version` subcommand, which exercises full boot plus tool registration). Making oam the default would mean either a launcher that probes for it on every start — a cost paid by everyone, including the majority who do not have oam installed — or making oam a hard requirement, which would break `npx @yawlabs/lemonsqueezy-mcp` for every user without it, since oam is not distributed on npm. Neither is worth it to reach a runtime that is slower here. Measure on your own hardware before concluding anything; if oam wins on yours, the config above is all you need.

Two places oam *does* win for this repo, both opt-in and neither touching the npm package:

- **`npm run check:oam`** — type-checks via `oam check` (tsgo, TypeScript 7 native). Measured 2878ms against 4406ms for `tsc --noEmit`, same clean result. `npx tsc --noEmit` remains the portable default and is what the pre-commit checklist calls for.
- **`npm run build:binary:oam`** — builds the standalone binary via `oam compile` instead of the Node SEA path. Measured 57.14 MB. Writes to the same `bin/<platform>-<arch>/` path as `npm run build:binary`, so the release staging script consumes either unchanged — run one or the other, not both. If you redistribute that binary it embeds oam's runtime, so ship oam's `LICENSE`, `NOTICE` and `THIRD_PARTY_LICENSES.md` with it.

The source stays runtime-agnostic on purpose: no `oam:` imports anywhere, and tests stay on `node:test`. That is what keeps the Node fallback real rather than nominal — an `oam:test` or `oam:`-prefixed import would make "falls back to Node" false the moment it landed. Any `oam` invocation writes a bytecode cache to `oam/` in the working directory; that path is gitignored.

## Releasing

Two paths from a clean checkout of `main`. Both produce the same artifact (npm publish with provenance + GitHub release).

### 1. Tag-and-let-CI (preferred)

```bash
# 1. Bump version
npm version X.Y.Z --no-git-tag-version

# 2. Commit
git add package.json && git commit -m "vX.Y.Z"

# 3. Annotated tag (lightweight tags are silently skipped by --follow-tags)
git tag -a vX.Y.Z -m "vX.Y.Z"

# 4. Push commit + tag
git push origin main --follow-tags

# 5. Confirm the Release workflow fired (not just CI on the bump commit)
gh run list --limit 2
```

The tag push triggers `.github/workflows/release.yml`, which runs `release.sh` in CI mode: lint, test, build, npm publish (with `--provenance`) using the org-level `NPM_TOKEN` secret, then GitHub release creation, then a smoke test against the published tarball, then a publish to the [Official MCP Registry](https://registry.modelcontextprotocol.io) via GitHub OIDC (no `MCP_*` secret needed; the namespace `io.github.YawLabs/*` is authorized purely from the OIDC `repository_owner` claim). No local `npm login` needed.

### 2. Local end-to-end

```bash
./release.sh X.Y.Z
```

Does the same steps 1–7 on the workstation: lint, test, build, bump, commit, annotated tag, push, npm publish, GitHub release, verify. Idempotent — safe to re-run with the same version after a partial failure. Requires one-time setup:

```bash
npm login --auth-type=web   # publisher of @yawlabs/lemonsqueezy-mcp
gh auth login               # GitHub CLI for the release-creation step
```

The local path does **not** publish to the Official MCP Registry — that step lives only in CI and depends on a GitHub Actions OIDC token. To push a locally-released version to the registry, install [`mcp-publisher`](https://github.com/modelcontextprotocol/registry/releases), run `mcp-publisher login github` (interactive OAuth), then `mcp-publisher publish` from the repo root.

## License

MIT
