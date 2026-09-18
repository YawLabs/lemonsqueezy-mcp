# @yawlabs/lemonsqueezy-mcp

MCP server for the [LemonSqueezy](https://lemonsqueezy.com) API. Manage your store, products, customers, subscriptions, discounts, license keys, and more from any MCP-compatible AI assistant.

[![Add to Yaw MCP](https://yaw.sh/yaw-mcp-button.svg)](https://yaw.sh/mcp/install?name=LemonSqueezy&command=npx&args=-y%2C%40yawlabs%2Flemonsqueezy-mcp&description=LemonSqueezy%20store%20management%20-%20products%2C%20orders%2C%20subscriptions%2C%20license%20keys&source=https%3A%2F%2Fgithub.com%2FYawLabs%2Flemonsqueezy-mcp)

One click adds this to your local Yaw MCP config so it's available in every Yaw Terminal session. Or install manually below.

## Quick start

```bash
npx -y @yawlabs/lemonsqueezy-mcp@latest
```

Requires Node.js 22 or later (`engines.node` is `>=22`).

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

A multi-stage `Dockerfile` is included at the repo root. The runtime image is a single bundled file on `node:22-alpine` running as the non-root `node` user, with no port exposed (stdio transport).

```bash
docker build -t yawlabs/lemonsqueezy-mcp .
docker run --rm -i -e LEMONSQUEEZY_API_KEY="your-api-key" yawlabs/lemonsqueezy-mcp
```

A matching `Containerfile` is provided for Podman users. It is generated from `Dockerfile` via `npm run gen:containerfile`. `release.sh` runs `npm run check:containerfile` in step 1, so a release fails if the two have drifted. This repo has no CI, so nothing checks a pull request for drift: run it yourself after editing `Dockerfile`.

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
- `ls_list_stores` — List all stores (not gated by `LEMONSQUEEZY_ALLOWED_STORE_IDS`: returns every store the API key can see)

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

Both annotate every price record with `effective_unit_price`, the cents actually charged per unit, and `effective_unit_price_note`, which says where that number came from; `unit_price_is_not_charged` or `unit_price_is_per_package` is added where it applies. Read `effective_unit_price` rather than `unit_price`, which is vestigial on tiered (`volume` / `graduated`) pricing, or a variant's `price`. The subscription-item reads apply the same annotation to prices embedded via `include=price`.

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
- `ls_deactivate_license` — Deactivate a license key instance (no API key required). Destructive on every call: rate-limited and audited, with the license key masked in the audit entry

### Affiliates
- `ls_get_affiliate` — Get an affiliate by ID (commission rate, status, earnings)
- `ls_list_affiliates` — List affiliates (filter by user email). Not gated by `LEMONSQUEEZY_ALLOWED_STORE_IDS`: returns affiliates from every store the API key can see

### Webhook sink (optional)
Bridge to a separate [@yawlabs/lemonsqueezy-webhook-sink](https://github.com/YawLabs/lemonsqueezy-webhook-sink) process so the agent can reconcile against webhooks that actually fired. Tools are always registered; if `LEMONSQUEEZY_SINK_URL` / `LEMONSQUEEZY_SINK_ADMIN_TOKEN` are unset, calls return a clear "not configured" error.

- `ls_sink_events_list` — List webhook events the sink has received (filter by `since` / `type` / `limit`)
- `ls_sink_event_mark_processed` — Mark a sink event as processed by your consumer (idempotent)
- `ls_sink_stats` — Get total events, unprocessed count, and last-received timestamp

## Features

- **API coverage** — 58 tools across 20 LemonSqueezy API resources, 3 License API tools, and 3 bridge tools to an optional [@yawlabs/lemonsqueezy-webhook-sink](https://github.com/YawLabs/lemonsqueezy-webhook-sink) for webhook reconciliation (64 in total)
- **JSON:API support** — Pagination on every `ls_list_*` tool, filters on every one but `ls_list_stores`, and relationship inclusion (`include`) on every `ls_get_*` / `ls_list_*` tool except `ls_get_user` and `ls_get_subscription_item_usage`
- **Zero runtime dependencies** — Single bundled file for instant `npx` startup
- **License API** — Activate, validate, and deactivate license keys without an API key
- **MCP annotations** — Every tool declares read-only, destructive, and idempotent hints
- **Retry with backoff** — for LemonSqueezy API calls (the `ls_sink_*` tools make a single attempt): a 429 is retried for every method, including POSTs such as refunds and License API calls, after waiting for the server's `Retry-After` (1s if it is missing or unparseable). This relies on a 429 meaning the request was rejected before LemonSqueezy acted on it. If `Retry-After` is over 30s, or the wait would pass the overall deadline, the 429 is returned instead. 5xx responses, timeouts and network errors are retried only for idempotent methods (GET, DELETE), with exponential backoff and jitter; a POST or PATCH that hits one is not retried. Up to 4 attempts, 30s per attempt, and no new attempt or wait is started after 90s
- **Guardrails** — opt-in store allowlist, refund cap, destructive-call rate limit, authority-class disable (`LEMONSQUEEZY_DISABLE_CLASSES`), and per-authority-class rate limits (`LEMONSQUEEZY_RATE_LIMIT_PER_CLASS`)
- **Audit log MCP Resource** — `lemonsqueezy://audit-log` exposes the last 1000 destructive-call entries as `application/x-ndjson` for clients without stderr access
- **Structured logging** — opt-in JSON logs to stderr with selectable levels (`error`, `audit`, `all`)

## Configuration

All configuration is via environment variables. The management-API tools need one of `LEMONSQUEEZY_API_KEY_COMMAND`, `LEMONSQUEEZY_TEST_API_KEY` or `LEMONSQUEEZY_API_KEY` (checked in that order); the three License API tools and the `ls_sink_*` tools need none of them. Everything else is opt-in.

| Variable | Purpose |
| --- | --- |
| `LEMONSQUEEZY_API_KEY` | LemonSqueezy API token. |
| `LEMONSQUEEZY_API_KEY_COMMAND` | Command whose stdout (trimmed, must be non-empty) is the API key. Takes precedence over `LEMONSQUEEZY_TEST_API_KEY` and `LEMONSQUEEZY_API_KEY`. Use this to pull short-lived credentials from a vault (`op read`, `gcloud secrets versions access`, etc.) without writing them to env vars. It is run directly, **not through a shell**: the string is split on spaces and tabs, single or double quotes group an argument (with no escapes inside them), and a backslash is a literal character. Adjacent quoted and unquoted text joins into one argument, and an empty `''` is dropped. There is no `$VAR` / `~` expansion, globbing, command substitution, piping or redirection. If you need any of those, put them in a script and invoke the script through its interpreter, e.g. `sh /path/get-key.sh`, `node get-key.js`, or on Windows `powershell -NoProfile -File C:\path\get-key.ps1`. **On Windows, a `.cmd` / `.bat` file cannot be launched directly, by bare name or by full path**, and many vault CLIs install as `.cmd` shims (e.g. `gcloud`): wrap them as `cmd /c gcloud secrets versions access ...`, or call an `.exe` such as `op`. The command gets 10 seconds, and stdout and stderr are each capped at 64 KB. Output is cached for 1 hour. The cache is keyed by the command string, so changing it mid-process refreshes on the next request; it is also invalidated automatically on a 401/403 from the API, so a key rotated upstream takes effect on the next call without waiting for the TTL. |
| `LEMONSQUEEZY_TEST_API_KEY` | Optional test-mode key. When set and non-empty, it takes precedence over `LEMONSQUEEZY_API_KEY` (but not over `LEMONSQUEEZY_API_KEY_COMMAND`). On first activation per process, the server prints a one-line JSON `test_mode` notice to stderr so you can confirm test mode is engaged. Use this to point the server at a sandbox/test store without unsetting your production key. |
| `LEMONSQUEEZY_ALLOWED_STORE_IDS` | Comma-separated allowlist of store IDs. When set: (1) any tool whose input includes a `storeId` rejects calls to a non-allowed store; (2) tools that *accept* a `storeId` filter (e.g. `ls_list_orders`, `ls_list_subscriptions`) require it — calls without one are blocked so a missing filter cannot return data from every store the API key can see. Tools with no `storeId` field at all are **not** gated by this allowlist, in three distinct shapes: (a) tools addressed by a resource ID (e.g. `ls_get_order`, `ls_refund_order`, `ls_cancel_subscription`, `ls_update_subscription_item`, `ls_create_usage_record`, `ls_archive_customer`, `ls_delete_webhook`, `ls_delete_discount`, `ls_update_license_key`) route by that ID, so the caller must already know it; (b) `ls_list_stores` and `ls_list_affiliates` take no scoping ID at all and **return rows from every store the API key can see** — `ls_list_stores` will enumerate stores outside the allowlist. Both say so in their own tool descriptions. (c) The License API tools (`ls_activate_license`, `ls_validate_license`, `ls_deactivate_license`) authenticate with the license key the caller passes, not the API key, so neither this allowlist nor account separation reaches them; see [Authority classes](#authority-classes) for the controls that do. Other list-by-parent tools (`ls_list_prices`, `ls_list_files`, `ls_list_variants`, `ls_list_order_items`, `ls_list_discount_redemptions`, `ls_list_license_key_instances`, `ls_list_subscription_items`, `ls_list_usage_records`) require a parent-ID filter when the allowlist is set — a partial mitigation, since that parent can itself belong to a non-allowed store. LemonSqueezy API keys are issued at the account level and authorize access to every store in that account, so this allowlist is the only in-process store boundary the server can enforce for the tools that use the API key. Pair it with `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` / `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` / `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS` for defense in depth, and — if your account hosts multiple stores you don't want exposed to the same agent — keep those stores under a separate LemonSqueezy account whose API key isn't reachable from this server. |
| `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` | Non-negative number. Rejects `ls_refund_order` and `ls_refund_subscription_invoice` calls above this amount (refund amounts are whole cents, so a fractional cap such as `99.5` allows up to 99). Unset or empty means no cap; **`0` is a valid value and blocks every refund** (the schemas require `amount >= 1`), so use it as a kill switch. A negative or non-numeric value stops the server at startup. The check runs *before* the rate limiters, so a rejected over-cap refund does not consume your destructive or `money`-class budget. |
| `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` | Non-negative number. Max destructive tool calls per 60-second rolling window (a fraction behaves as the next whole number: `2.5` allows 3 calls). Unset or empty means no limit; **`0` blocks every destructive call.** A negative or non-numeric value stops the server at startup. In-process limit — per MCP server instance, not global; each `npx` cold start resets the window. **Destructive on every call** (whatever the input): `ls_refund_order`, `ls_refund_subscription_invoice`, `ls_cancel_subscription`, `ls_update_subscription_item`, `ls_create_usage_record`, `ls_archive_customer`, `ls_delete_discount`, `ls_delete_webhook` and `ls_deactivate_license`. **Destructive depending on input:** `ls_update_license_key` when it sets `disabled: true` or passes any `activationLimit` or `expiresAt` (`null` included); `ls_update_subscription` when it pauses (`pause: "void"` or `"free"`), switches plan (`variantId`), passes `billingAnchor`, passes `trialEndsAt` (a date or `null`), or sets `invoiceImmediately: true`; `ls_update_customer` with `status: "archived"`; and `ls_update_webhook` when it passes `secret`. No other tool call is destructive. A destructive call refused first by `LEMONSQUEEZY_DISABLE_CLASSES`, the refund cap or `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS` never reaches this counter, so it is not counted. Every destructive call, including a blocked one, is tagged `audit: true` in the log and recorded in `lemonsqueezy://audit-log`. MCP clients see `destructiveHint: true` on all 13 of these tools, including the four input-dependent ones, because an annotation is static; the server-side count for those four is per call. |
| `LEMONSQUEEZY_DISABLE_CLASSES` | Comma-separated list of [authority classes](#authority-classes) to refuse outright. Any tool whose class is listed returns a `guardrail_block` before the API call is attempted. Example: `LEMONSQUEEZY_DISABLE_CLASSES=money,recurring,pii` blocks refunds, subscription changes and usage reporting, and the dedicated customer tools, while leaving the `read`, `mutate`, `key` and `webhook` classes open. Disabling `pii` does not keep customer data away from the agent: read-class tools still return customer names and emails (see the note under [Authority classes](#authority-classes)). Unknown class names stop the server at startup. |
| `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS` | Per-class rolling rate limits, comma-separated. Each entry is `class:N`, `class:N/m`, or `class:N/h` (bare numbers default to per-minute). Example: `money:2/h,recurring:5/h,key:10/m`. A `recurring` budget counts usage reports (`ls_create_usage_record`) alongside subscription changes, so size it for any metering agent. Composes with `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` — both must pass. A limit of `0` blocks every call in that class; classes you don't list are unlimited. Malformed entries throw at server startup. In-process per server instance. |
| `LEMONSQUEEZY_LOG` | Structured-log verbosity to stderr. Set to `all` (or legacy `json`) to log every tool and HTTP call, `audit` to log only destructive-call audit entries plus errors (recommended for production), `error` to log only failures. Unset (or any other value): no logs. Destructive calls are tagged `audit: true` and include their inputs, redacted as described under [Resources](#resources) (the stderr log and the audit-log resource apply the same redaction). Failure entries carry a `status` that identifies the cause. On `tool_call` lines: `guardrail_block` (operator policy refused the call), `validation_error` (the client sent a malformed request, e.g. an update with no fields to change), `exception` (something faulted), or `error` (the tool returned an error result, such as an HTTP error from LemonSqueezy or a timed-out request). On `http_call` lines: `timeout`, `network_error`, or the HTTP status code. |
| `LEMONSQUEEZY_SINK_URL` | Base URL of an optional [@yawlabs/lemonsqueezy-webhook-sink](https://github.com/YawLabs/lemonsqueezy-webhook-sink) instance (e.g. `https://webhooks.example.com`). Trailing slashes are stripped. Enables the `ls_sink_*` reconciliation tools below. Unset: the tools are still registered but return a "not configured" error when called. |
| `LEMONSQUEEZY_SINK_ADMIN_TOKEN` | Bearer token for the sink's admin endpoints. Must match the sink's `WEBHOOK_SINK_ADMIN_TOKEN`. Required when `LEMONSQUEEZY_SINK_URL` is set; if the sink itself was started without an admin token, its admin endpoints return 404 and `ls_sink_*` calls surface that diagnostically. |

### Logging format

Each line: `{ts, event, tool?, method?, path?, status, latency_ms, request_id?, error?, audit?, inputs?}`. Stdout is reserved for the MCP protocol — never log there.

### Error decoration

HTTP errors include the upstream `X-Request-Id` when present, so support tickets to LemonSqueezy can reference the exact call. When an error body is JSON with no message the server recognizes, it is surfaced whole, in both the error text and the log line, after the same redaction as audited inputs (see [Resources](#resources)). A non-JSON error body is passed through as-is.

## Authority classes

**The strongest access control LemonSqueezy itself exposes is the API key boundary.** A LemonSqueezy API key authorizes its full account — every store, and every tool except the three License API tools (see below) and the three `ls_sink_*` bridge tools, which do not use it — and the only way to deny a class of authority through LemonSqueezy is to not give the API key to the agent in the first place. LemonSqueezy's team-membership UI scopes which humans can do which actions in the dashboard, but the public API key inherits the full authority of the account it was issued under; there's no "this key can read but not refund" toggle. So the authoritative boundary, as far as the upstream API is concerned, is *which API key the agent has*.

That means the env vars below are the primary in-process control surface for anything LemonSqueezy can't gate by itself — per-class rate ceilings (`RATE_LIMIT_PER_CLASS`), deploy-time class disables (`DISABLE_CLASSES`), refund caps (`MAX_REFUND_AMOUNT_CENTS`), and the audit log. They are belt-and-braces in the sense that an operator who can change the server's env can remove them; they are load-bearing in the sense that LemonSqueezy has no equivalent. If you need an agent that genuinely cannot reach a store or a class of action, the durable answer is a separate LemonSqueezy account whose key is never handed to that agent. That answer does not cover the License API tools (see below).

Every tool is tagged with an **authority class** — a label for the kind of business authority a caller needs to invoke it. The class is separate from the binary destructive/read-only annotation: a customer-record read and a product list are both reads, but only one returns PII; a checkout creation and a refund are both writes, but only one moves money.

| Class | What it covers | Tools |
| --- | --- | --- |
| `read` | Safe reads (list/get) that don't return customer PII as the primary payload. | Every `ls_get_*` and `ls_list_*` tool except `ls_get_customer` and `ls_list_customers`, plus `ls_validate_license`, `ls_sink_events_list` and `ls_sink_stats` |
| `pii` | The dedicated customer-record tools. This class does not keep customer data out of reach; see the note below. | `ls_get_customer`, `ls_list_customers`, `ls_create_customer`, `ls_update_customer`, `ls_archive_customer` |
| `mutate` | Non-money mutations: checkouts, discounts, invoice generation, marking sink events processed. | `ls_create_checkout`, `ls_create_discount`, `ls_delete_discount`, `ls_generate_order_invoice`, `ls_generate_subscription_invoice`, `ls_sink_event_mark_processed` |
| `money` | Money movement. Irreversible at the payment layer. | `ls_refund_order`, `ls_refund_subscription_invoice` |
| `recurring` | Subscription state and metered billing: changes that affect recurring revenue. | `ls_update_subscription`, `ls_cancel_subscription`, `ls_update_subscription_item`, `ls_create_usage_record` |
| `key` | License-key admin (activate, deactivate, disable, change activation limit or expiry). | `ls_update_license_key`, `ls_activate_license`, `ls_deactivate_license` |
| `webhook` | Webhook configuration — affects the trust surface other systems rely on. | `ls_create_webhook`, `ls_update_webhook`, `ls_delete_webhook` |

That is every tool's class. `src/tools/tools.test.ts` pins the same map, and moving a tool to another class is a MAJOR change under [SEMVER.md](./SEMVER.md).

Note: `pii` gates only the five customer tools above. It does **not** keep customer data out of an agent's reach: read-class tools still return customer names and emails incidentally (orders, subscriptions and license keys carry them), `ls_list_orders` and `ls_list_subscriptions` accept a `userEmail` filter, and the order, subscription and license-key get/list tools accept `include=customer`, which side-loads the customer record. The class is reserved for tools whose *primary purpose* is the customer record, so `LEMONSQUEEZY_DISABLE_CLASSES=pii` blocks those tools, not customer data. To keep customer data away from an agent, issue its API key from a separate LemonSqueezy account that doesn't host customer records you care about.

**The License API tools are outside the API-key boundary.** `ls_activate_license`, `ls_validate_license` and `ls_deactivate_license` authenticate with the license key the caller passes, not the API key, so they work on any LemonSqueezy account's license keys, whichever API key the server holds. A separate LemonSqueezy account does not fence them off, and `LEMONSQUEEZY_ALLOWED_STORE_IDS` does not gate them. The controls that do reach them, per tool:

- **`ls_deactivate_license`** (class `key`): `LEMONSQUEEZY_DISABLE_CLASSES=key`, `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS=key:N`, and `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT`, which treats every call as destructive. Every call is also audited, with the license key masked (see [Resources](#resources)).
- **`ls_activate_license`** (class `key`): the same two class controls. Activation is additive, so it is not destructive, and the destructive rate limit and the audit log do not see it.
- **`ls_validate_license`** (class `read`): only `LEMONSQUEEZY_DISABLE_CLASSES=read` or `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS=read:N`, and both of those also hit every other read. The read-only lock-down below leaves it reachable.

Both `key` controls also cover `ls_update_license_key`, the management-API tool in the same class.

The two opt-in env vars that consume this taxonomy:

- `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS` — caps the call rate per class. LemonSqueezy permissions cannot express "max 2 refunds per hour"; this is the only place that policy can live. **This is the load-bearing one for runaway-agent prevention.**
- `LEMONSQUEEZY_DISABLE_CLASSES` — blocks a class outright. Useful when fast deploy-time toggles matter — flipping `DISABLE_CLASSES=pii,mutate,money,recurring,key,webhook` to lock an analytics deployment into pure reads is a one-line config change (every `read` tool stays reachable, `ls_validate_license` included). An operator who can change the server's env can also remove this gate, so for an authoritative deny use a separate LemonSqueezy account whose API key the agent never sees; that does not bound the License API tools.

Both are opt-in; with neither set, every class is allowed and unlimited.

## Resources

The server exposes one MCP Resource for clients that prefer structural retrieval over parsing stderr:

| URI | MIME type | Contents |
| --- | --- | --- |
| `lemonsqueezy://audit-log` | `application/x-ndjson` | The most recent destructive tool calls and outcomes (rate-limit blocks, refund-cap blocks, exceptions, successes). Bounded ring buffer of the last 1000 entries, most-recent-first, resets on server restart. Inputs are redacted before they reach the buffer, and the stderr log gets the same redacted copy. (1) Any object key whose whole name matches a credential / PII pattern (`secret`, `password`, `token`, `api_key`, `bearer`, `authorization`, `signing_secret`, `private_key`, `pin`, `ssn`, `social_security_number`, `credit_card`, `card_number`, `cvv`, `cvc` — case-insensitive, and the `_` in a compound name may also be `-` or absent) has its value replaced with `[REDACTED]`. (2) A key named `licenseKey`, `license_key` or `license-key` (any case) holds a License API credential, so its value is masked: a string of 16 or more characters becomes `[REDACTED:last4=XXXX]`, keeping its last four characters so an entry can be correlated with a key without exposing it, and any other value becomes `[REDACTED]`. (3) Any string value matching the JWT bearer-token shape (`eyJ…`-prefixed, three base64url segments) becomes `[REDACTED]` under whatever key it appears. Rules (1) and (2) go by key name, so a license key stored under some other key name is not masked. Values under any other key name are kept, including the IDs `licenseKeyId`, `license_key_id`, `licenseKeyInstanceId`, `instanceId`, `storeId`, `orderId` and `webhookId`, and UUID-shaped values. |

## Operating the server unattended

For unattended/agentic use against a live store, we recommend:

1. Issue an API key under a LemonSqueezy account that hosts only the store(s) the agent is allowed to touch — LemonSqueezy doesn't expose per-store API-key scoping, so account separation is the durable store boundary. Set `LEMONSQUEEZY_ALLOWED_STORE_IDS` to the same set as a belt-and-braces in-process gate on the tools that take a `storeId`. Account separation does not bound the three License API tools, which authenticate with a license key rather than the API key (see [Authority classes](#authority-classes)).
2. Set `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` to a per-call cap well below any single-refund expectation.
3. Set `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` to a small number (e.g. 5/min) as a runaway-agent circuit breaker. For finer control, add `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS=money:2/h,recurring:5/h,key:10/m` so each [authority class](#authority-classes) has its own ceiling. If the agent also reports metered usage, size the `recurring` figure for that too: usage reports count against it.
4. If a class shouldn't be reachable at all (e.g. an analytics agent that needs only `read`), set `LEMONSQUEEZY_DISABLE_CLASSES` to the classes you want refused. The server rejects them before the API call is built. For an irrevocable deny, also issue the agent's API key from a separate LemonSqueezy account (the License API tools excepted).
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
npm test                  # full unit + handler suite (builds first)
npm run test:integration  # live suite; exits 1 unless LEMONSQUEEZY_TEST_API_KEY + LEMONSQUEEZY_TEST_STORE_ID are set
```

This repo has no CI: nothing re-runs lint, types or tests on a pull request, so run them locally. `npm run test:integration` writes throwaway `ci-test-` resources to a real store.

`Containerfile` is generated from `Dockerfile`. After editing `Dockerfile`:

```bash
npm run gen:containerfile    # regenerate Containerfile
npm run check:containerfile  # release.sh step 1 runs this too; non-zero exit means the two have drifted
```

## Running on oam.js (optional)

[oam.js](https://oamjs.org) runs this server unmodified, and the launcher only runs the server on an oam that is **0.15.2 or newer**. Verified against oam 0.9.0: full MCP handshake, all 64 tools, the `lemonsqueezy://audit-log` resource, working `fetch`, and guardrail rejections with error text identical to Node. On oam 0.15.2 the MCP handshake and all 64 tools have been re-verified through the launcher, with and without the sandbox below.

**oam 0.15.2 is the minimum.** The launcher picks the newest oam it can find at or above it, never serves on an older one, and falls back to Node when there is none (`LEMONSQUEEZY_MCP_RUNTIME=oam` turns that into a hard error). A floor matters here: releases before 0.9.0 ran `child_process.execFile` arguments through a shell, which was reachable whenever `LEMONSQUEEZY_API_KEY_COMMAND` is configured -- that feature runs the key command with `execFile`, deliberately without a shell, and on those releases its arguments were re-split by one anyway.

The published `lemonsqueezy-mcp` command (`bin/lemonsqueezy-mcp.mjs`, which is what `npx` runs) chooses its runtime from these variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `LEMONSQUEEZY_MCP_RUNTIME` | `auto` | `auto`: serve on the oam the launcher is already running under if that is 0.15.2 or newer (unless `LEMONSQUEEZY_MCP_SANDBOX=1`); otherwise run on the newest oam binary it can find at 0.15.2 or newer (see `OAM_BIN`); otherwise on Node. An oam host older than 0.15.2 never serves the server itself -- it hands off to the newest usable oam, or to Node on `PATH`, or exits with an error when there is neither. On stderr, an `OAM_BIN` that was passed over is always named. The other oam binaries passed over, and any `oam.cmd` / `oam.bat` shim, are named only when no usable oam is found -- an older copy skipped for a newer one is not mentioned. A chosen oam that fails to launch, and a handoff to Node from an oam host older than 0.15.2, are always reported; when such a host hands off to a newer oam instead, nothing is printed. `oam`: the same, but exit with an error instead of falling back. `node`: always Node -- in-process under `npx`, and handed off to Node on `PATH` when a client launches the command with `oam run`. Case-insensitive, and any other value behaves like `auto`. |
| `OAM_BIN` | unset | Path to an oam binary to use in preference to discovery, when it is 0.15.2 or newer. If it does not exist, is older, or will not run, the launcher says so on stderr and carries on with discovery. Discovery looks in the installed location (`%LOCALAPPDATA%\oam\bin` then `~/.oam/bin` on Windows, `~/.oam/bin` elsewhere) and on `PATH`, asks every oam it finds for its version, and uses the newest; on a tie the installed copy wins. On Windows only `oam.exe` counts: an `oam.cmd` / `oam.bat` shim is never run, and is named on stderr only when no usable oam is found. Ignored under `LEMONSQUEEZY_MCP_RUNTIME=node`, and when already running on oam 0.15.2+ without the sandbox. |
| `LEMONSQUEEZY_MCP_SANDBOX` | unset | `1` runs the server under `--permission`; see below. |

### Sandboxing (opt-in)

Set `LEMONSQUEEZY_MCP_SANDBOX=1` to run under oam's `--permission` model: network restricted to `api.lemonsqueezy.com` (plus the host of `LEMONSQUEEZY_SINK_URL` when set), filesystem denied outright, and child-process denied unless `LEMONSQUEEZY_API_KEY_COMMAND` is configured.

`--permission` is a process-level flag, so the launcher always starts a fresh oam for it -- even when a client already launches the command under oam 0.15.2+. That is a preference, not a guarantee: if no usable oam can be started, `LEMONSQUEEZY_MCP_RUNTIME=auto` still serves the server **without** `--permission`, and `LEMONSQUEEZY_MCP_RUNTIME=oam` exits with an error instead.

It is opt-in rather than default because a wrong grant does not fail loudly. oam denies a non-granted environment variable by making it **absent** from `process.env` rather than throwing, so an under-granted `LEMONSQUEEZY_API_KEY` reads as "unauthenticated" rather than "denied". The env allow-list in the launcher is derived from what the shipped bundle actually reads -- if you add a new `process.env` lookup, extend that list with it.

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

**The published command prefers oam; it does not require it.** oam is not distributed on npm, so `npx @yawlabs/lemonsqueezy-mcp` has to keep working without it, and it does: discovery is file-existence checks only, never a subprocess, and the fallback runs the server inside the Node process npm already started. With oam installed, though, the command boots Node, runs `--version` on every oam binary it found to pick the newest, and only then boots oam, so it is always slower than pointing your client at oam directly with the config above. `LEMONSQUEEZY_MCP_RUNTIME=node` skips oam entirely. An MCP client cold-starts this server once per session, so startup is the cost that actually gets paid -- and it has not been measured for this repo on a current oam. Measure on your own hardware before concluding anything.

Two places oam *does* win for this repo, both opt-in and neither touching the npm package:

- **`npm run check:oam`** — type-checks via `oam check` (tsgo, TypeScript 7 native). Measured 2878ms against 4406ms for `tsc --noEmit`, same clean result. `npx tsc --noEmit` remains the portable default and is what the pre-commit checklist calls for.
- **`npm run build:binary:oam`** — builds the standalone binary via `oam compile` instead of the Node SEA path. Measured 57.14 MB. Writes to the same `bin/<platform>-<arch>/` path as the Node SEA build (`node scripts/build-binary.mjs`), so `scripts/stage-release-asset.mjs` consumes either unchanged — run one or the other, not both. If you redistribute that binary it embeds oam's runtime, so ship oam's `LICENSE`, `NOTICE` and `THIRD_PARTY_LICENSES.md` with it.

The source stays runtime-agnostic on purpose: no `oam:` imports anywhere, and tests stay on `node:test`. That is what keeps the Node fallback real rather than nominal — an `oam:test` or `oam:`-prefixed import would make "falls back to Node" false the moment it landed. Any `oam` invocation writes a bytecode cache to `oam/` in the working directory; that path is gitignored.

## Releasing

Releases run locally, from a clean checkout of `main`, with `release.sh`. This repo has no GitHub Actions workflows (`.github/` holds only `CODEOWNERS`), so pushing a tag by itself publishes nothing. `release.sh` keeps a CI mode for a tag-triggered release workflow, the intended end state, but nothing invokes it today.

Before cutting a release, write the `## [Unreleased]` entry in `CHANGELOG.md` by hand, and run `npm run test:integration` against a test-mode store if `src/api.ts` or a tool handler changed (it needs `LEMONSQUEEZY_TEST_API_KEY` and `LEMONSQUEEZY_TEST_STORE_ID`, and exits 1 without them). The unit suite mocks `fetch`, so it cannot see changes in the upstream API. Then:

```bash
./release.sh X.Y.Z
```

Before step 1, `release.sh` checks that `gh` is installed and authenticated and that you are on `main`, and refuses a dirty working tree unless it is resuming a run whose version bump already landed. Unless `X.Y.Z` is already on npm, it also runs `npm whoami` and stops if that fails, so a dead or missing npm token ends the run before step 4 pushes the tag. `npm whoami` proves the token is live, not that it is an automation token: a web-login session passes it and then fails step 5 with `EOTP`.

It then runs eight steps on the workstation:

1. `npm run lint`, and `npm run check:containerfile` (fails if `Containerfile` has drifted from `Dockerfile`)
2. `npm test` (which builds first)
3. Bump the version in `package.json` and `package-lock.json`, and sync `server.json` to it
4. Turn `## [Unreleased]` in `CHANGELOG.md` into `## [X.Y.Z]` (when `[Unreleased]` is empty, write that section from the commit subjects since the previous tag instead, with a warning), commit, create the annotated tag `vX.Y.Z`, and push `main` with the tag
5. `npm publish --access public`
6. Create the GitHub release, with the notes taken from the `## [X.Y.Z]` section of `CHANGELOG.md`
7. Wait for npm to serve the new version (up to 5 minutes, then carry on with a warning), smoke-test `npx -y @yawlabs/lemonsqueezy-mcp@X.Y.Z --version`, then publish `server.json` to the [Official MCP Registry](https://registry.modelcontextprotocol.io) with `mcp-publisher`
8. Verify the npm version, `package.json` and the tag

Re-running after a partial failure is safe. `./release.sh X.Y.Z` detects the version bump, commit, tag, npm publish and GitHub release that already landed and skips them; lint, test, the push and the npx smoke test run again. The MCP Registry publish in step 7 is not skipped, so a re-run after it has succeeded fails there on the duplicate version.

A workstation publish carries no npm provenance attestation: `release.sh` passes `--provenance` only in CI mode.

One-time setup on each machine:

- **An npm automation token** for a publisher of `@yawlabs/lemonsqueezy-mcp`, in `~/.npmrc` (npmjs.com -> Access Tokens -> Generate -> Automation):

  ```ini
  @yawlabs:registry=https://registry.npmjs.org/
  //registry.npmjs.org/:_authToken=npm_YOURTOKEN
  ```

  **Never run `npm login --auth-type=web`.** It overwrites the automation token with a 2FA-bound web session, and the next publish fails with `EOTP`.
- **`gh auth login`.** The pre-flight requires it, and step 6 creates the release with it. Step 7 logs `mcp-publisher` in with its token (`gh auth token`) unless `MCP_REGISTRY_TOKEN` is set; either way the token needs `read:org` access to YawLabs, which the registry checks for the `io.github.YawLabs/*` namespace. `mcp-publisher` is downloaded to `~/.local/bin` on first use; set `MCP_PUBLISHER` to use another copy.
- **`jq`, `curl` and `tar` on `PATH`.** Step 3 edits `server.json` with `jq`. Step 7 downloads `mcp-publisher` with `curl` and `tar` on first use, unless `MCP_PUBLISHER` points at an existing copy. It also polls npm with `curl`, and skips that wait with a warning if `curl` is missing.
- **Rights to push to `main` and create `v*` tags.** The repository rulesets require a pull request for `main` and restrict `v*` tag creation, only organization admins bypass them, and step 4 pushes both directly.

## License

MIT

[![Follow @TokenLimitNews on X](https://img.shields.io/badge/follow-%40TokenLimitNews-000000?logo=x&logoColor=white)](https://x.com/TokenLimitNews)
