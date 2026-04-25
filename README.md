# @yawlabs/lemonsqueezy-mcp

MCP server for the [LemonSqueezy](https://lemonsqueezy.com) API. Manage your store, products, customers, subscriptions, discounts, license keys, and more from any MCP-compatible AI assistant.

## Quick start

```bash
npx @yawlabs/lemonsqueezy-mcp
```

## Setup

Set your LemonSqueezy API key as an environment variable:

```bash
export LEMONSQUEEZY_API_KEY="your-api-key"
```

Get your API key from your [LemonSqueezy dashboard](https://app.lemonsqueezy.com/settings/api).

### Claude Code

Add to your MCP config:

```json
{
  "mcpServers": {
    "lemonsqueezy": {
      "command": "npx",
      "args": ["-y", "@yawlabs/lemonsqueezy-mcp"],
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
      "args": ["-y", "@yawlabs/lemonsqueezy-mcp"],
      "env": {
        "LEMONSQUEEZY_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Tools (61)

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

## Features

- **Full API coverage** — All 17 LemonSqueezy API resources with 61 tools
- **JSON:API support** — Filtering, pagination, and relationship inclusion on all list/get operations
- **Zero runtime dependencies** — Single bundled file for instant `npx` startup
- **License API** — Activate, validate, and deactivate license keys without an API key
- **MCP annotations** — Every tool declares read-only, destructive, and idempotent hints
- **Retry with backoff** — 429 and 5xx retries (idempotent methods only) with exponential backoff and jitter
- **Guardrails** — optional store allowlist, refund cap, and destructive-call rate limit
- **Structured logging** — opt-in JSON logs to stderr for observability and audit

## Configuration

All configuration is via environment variables. Only `LEMONSQUEEZY_API_KEY` (or `LEMONSQUEEZY_API_KEY_COMMAND`) is required; everything else is opt-in.

| Variable | Purpose |
| --- | --- |
| `LEMONSQUEEZY_API_KEY` | LemonSqueezy API token. |
| `LEMONSQUEEZY_API_KEY_COMMAND` | Command whose stdout produces the API key. Overrides `LEMONSQUEEZY_API_KEY`. Output is cached for 1 hour. Use this to pull short-lived credentials from a vault (`op read`, `gcloud secrets versions access`, etc.) without writing them to env vars. |
| `LEMONSQUEEZY_ALLOWED_STORE_IDS` | Comma-separated allowlist of store IDs. When set: (1) any tool whose input includes a `storeId` rejects calls to a non-allowed store; (2) tools that *accept* a `storeId` filter (e.g. `ls_list_orders`, `ls_list_subscriptions`) require it — calls without one are blocked so a missing filter cannot return data from every store the API key can see. Tools with no `storeId` field at all (e.g. `ls_refund_order`, `ls_list_stores`) are not gated by this — pair with `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` and `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT`. |
| `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` | Rejects `ls_refund_order` and `ls_refund_subscription_invoice` calls above this amount. |
| `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` | Max destructive tool calls per 60-second rolling window. In-process limit — per MCP server instance, not global; each `npx` cold start resets the window. Counts include `ls_update_license_key` calls that set `disabled: true`. |
| `LEMONSQUEEZY_LOG=json` | Emit one JSON log line to stderr per tool and HTTP call. Destructive calls are tagged `audit: true` and include their inputs. |

### Logging format

Each line: `{ts, event, tool?, method?, path?, status, latency_ms, request_id?, error?, audit?, inputs?}`. Stdout is reserved for the MCP protocol — never log there.

### Error decoration

HTTP errors include the upstream `X-Request-Id` when present, so support tickets to LemonSqueezy can reference the exact call.

## Operating the server unattended

For unattended/agentic use against a live store, we recommend:

1. Set `LEMONSQUEEZY_ALLOWED_STORE_IDS` to the specific store(s) the agent may touch.
2. Set `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` to a per-call cap well below any single-refund expectation.
3. Set `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` to a small number (e.g. 5/min) as a runaway-agent circuit breaker.
4. Set `LEMONSQUEEZY_LOG=json` and ship stderr to your log aggregator. Alert on `status: "guardrail_block"` or elevated error rates per tool.
5. Run `LEMONSQUEEZY_API_KEY_COMMAND` against a vault-backed secret so credentials can rotate without restarting the server process.

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

## Releasing

Releases are cut locally — there is no CI pipeline. From a clean checkout of `main`:

```bash
./release.sh 0.6.0
```

The script lints, tests, builds, bumps the version, commits and tags, pushes to `origin`, publishes to npm, and creates a GitHub release. Each step is idempotent — re-running with the same version after a partial failure resumes from where it stopped.

One-time setup on the release machine:

```bash
npm login --auth-type=web   # publisher of @yawlabs/lemonsqueezy-mcp
gh auth login               # GitHub CLI for the release-creation step
```

## License

MIT
