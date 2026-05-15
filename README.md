# @yawlabs/lemonsqueezy-mcp

MCP server for the [LemonSqueezy](https://lemonsqueezy.com) API. Manage your store, products, customers, subscriptions, discounts, license keys, and more from any MCP-compatible AI assistant.

[![Add to mcp.hosting](https://mcp.hosting/install-button.svg)](https://mcp.hosting/install?name=LemonSqueezy&command=npx&args=-y%2C%40yawlabs%2Flemonsqueezy-mcp&description=LemonSqueezy%20store%20management%20-%20products%2C%20orders%2C%20subscriptions%2C%20license%20keys&source=https%3A%2F%2Fgithub.com%2FYawLabs%2Flemonsqueezy-mcp)

One click adds this to your [mcp.hosting](https://mcp.hosting) account so it syncs to every MCP client you use. Or install manually below.

## Quick start

```bash
npx @yawlabs/lemonsqueezy-mcp
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

A byte-identical `Containerfile` is also provided for Podman users.

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
| `LEMONSQUEEZY_API_KEY_COMMAND` | Command whose stdout produces the API key. Overrides `LEMONSQUEEZY_API_KEY`. Output is cached for 1 hour. Use this to pull short-lived credentials from a vault (`op read`, `gcloud secrets versions access`, etc.) without writing them to env vars. The cache is keyed by the command string, so changing it mid-process refreshes on the next request; it is also invalidated automatically on a 401/403 from the API, so a key rotated upstream takes effect on the next call without waiting for the TTL. |
| `LEMONSQUEEZY_TEST_API_KEY` | Optional test-mode key. When set and non-empty, it takes precedence over `LEMONSQUEEZY_API_KEY` (but not over `LEMONSQUEEZY_API_KEY_COMMAND`). On first activation per process, the server prints a one-line JSON `test_mode` notice to stderr so you can confirm test mode is engaged. Use this to point the server at a sandbox/test store without unsetting your production key. |
| `LEMONSQUEEZY_ALLOWED_STORE_IDS` | Comma-separated allowlist of store IDs. When set: (1) any tool whose input includes a `storeId` rejects calls to a non-allowed store; (2) tools that *accept* a `storeId` filter (e.g. `ls_list_orders`, `ls_list_subscriptions`) require it — calls without one are blocked so a missing filter cannot return data from every store the API key can see. Tools with no `storeId` field at all (e.g. `ls_refund_order`, `ls_cancel_subscription`, `ls_archive_customer`, `ls_delete_webhook`, `ls_delete_discount`, `ls_update_license_key`, `ls_list_stores`) route by their own resource ID and are **not** gated by this allowlist. For those, the only authoritative store boundary is the API key itself — pair this setting with a LemonSqueezy API key scoped to the same store(s), and pair with `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` / `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` for additional defense in depth. |
| `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` | Rejects `ls_refund_order` and `ls_refund_subscription_invoice` calls above this amount. |
| `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` | Max destructive tool calls per 60-second rolling window. In-process limit — per MCP server instance, not global; each `npx` cold start resets the window. Counts include `ls_update_license_key` calls that set `disabled: true`, and `ls_update_subscription` calls that pause or switch plan. |
| `LEMONSQUEEZY_DISABLE_CLASSES` | Comma-separated list of [authority classes](#authority-classes) to refuse outright. Any tool whose class is listed returns a `guardrail_block` before the API call is attempted. Example: `LEMONSQUEEZY_DISABLE_CLASSES=money,recurring,pii` lets an agent run reads but blocks refunds, subscription changes, and customer-record access. Unknown class names throw at server startup. |
| `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS` | Per-class rolling rate limits, comma-separated. Each entry is `class:N`, `class:N/m`, or `class:N/h` (bare numbers default to per-minute). Example: `money:2/h,recurring:5/h,key:10/m`. Composes with `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` — both must pass. In-process per server instance. |
| `LEMONSQUEEZY_LOG` | Structured-log verbosity to stderr. Set to `all` (or legacy `json`) to log every tool and HTTP call, `audit` to log only destructive-call audit entries plus errors (recommended for production), `error` to log only failures. Unset: no logs. Destructive calls are tagged `audit: true` and include their inputs. |

### Logging format

Each line: `{ts, event, tool?, method?, path?, status, latency_ms, request_id?, error?, audit?, inputs?}`. Stdout is reserved for the MCP protocol — never log there.

### Error decoration

HTTP errors include the upstream `X-Request-Id` when present, so support tickets to LemonSqueezy can reference the exact call.

## Authority classes

**Authoritative access control is the LemonSqueezy API key itself.** If you need an agent that can't refund or can't touch a particular store, the right primary control is a LemonSqueezy API key scoped to deny that authority — issued via your LemonSqueezy team-membership settings. A scoped key can't be bypassed by unsetting an env var, so it should be the first line of defense for anything load-bearing.

The class layer below is **defense in depth on top of that** — useful for things scoped API keys can't express (per-class rate ceilings, fast deploy-time toggles, audit-log clarity), not a substitute for them.

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

Note: `ls_get_order` returns customer fields incidentally, but its primary payload is the order — it stays in `read`, not `pii`. The class is reserved for tools whose *primary purpose* is the customer record. If you need to deny all access to customer-shaped data, use a scoped API key — class-disable is defense in depth, not the authoritative boundary.

The two opt-in env vars that consume this taxonomy:

- `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS` — caps the call rate per class. No access-control equivalent: there's no way to express "max 2 refunds per hour" as a LemonSqueezy permission, so this is the only place that policy can live. **This is the load-bearing one for runaway-agent prevention.**
- `LEMONSQUEEZY_DISABLE_CLASSES` — blocks a class outright. Overlaps significantly with issuing a scoped LemonSqueezy API key. Worth setting when fast deploy-time toggles matter more than authoritative enforcement (e.g. an analytics deployment that should never touch writes — easier to set `DISABLE_CLASSES=pii,mutate,money,recurring,key,webhook` than to coordinate a key rotation). Otherwise, prefer the scoped key.

Both are opt-in; with neither set, behavior is unchanged from prior versions.

## Resources

The server exposes one MCP Resource for clients that prefer structural retrieval over parsing stderr:

| URI | MIME type | Contents |
| --- | --- | --- |
| `lemonsqueezy://audit-log` | `application/x-ndjson` | The most recent destructive tool calls and outcomes (rate-limit blocks, refund-cap blocks, exceptions, successes). Bounded ring buffer of the last 1000 entries, most-recent-first, resets on server restart. Secret-shaped input fields are redacted before they reach the buffer. |

## Operating the server unattended

For unattended/agentic use against a live store, we recommend:

1. Use a LemonSqueezy API key scoped to the specific store(s) the agent may touch — this is the only authoritative store boundary for tools that route by their own resource ID (refunds, cancels, archive, delete-webhook, etc.). Set `LEMONSQUEEZY_ALLOWED_STORE_IDS` to the same set as a defense-in-depth gate on the tools that *do* take a `storeId`.
2. Set `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` to a per-call cap well below any single-refund expectation.
3. Set `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` to a small number (e.g. 5/min) as a runaway-agent circuit breaker. For finer control, add `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS=money:2/h,recurring:5/h,key:10/m` so each [authority class](#authority-classes) has its own ceiling.
4. If a class shouldn't be reachable at all (e.g. an analytics agent that needs only `read`), the authoritative answer is a scoped LemonSqueezy API key. `LEMONSQUEEZY_DISABLE_CLASSES` is a fast deploy-time alternative when the cost of coordinating a key rotation outweighs the strength gained — useful but not load-bearing.
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

The tag push triggers `.github/workflows/release.yml`, which runs `release.sh` in CI mode: lint, test, build, npm publish (with `--provenance`) using the org-level `NPM_TOKEN` secret, then GitHub release creation, then a smoke test against the published tarball. No local `npm login` needed.

### 2. Local end-to-end

```bash
./release.sh X.Y.Z
```

Does the same steps 1–7 on the workstation: lint, test, build, bump, commit, annotated tag, push, npm publish, GitHub release, verify. Idempotent — safe to re-run with the same version after a partial failure. Requires one-time setup:

```bash
npm login --auth-type=web   # publisher of @yawlabs/lemonsqueezy-mcp
gh auth login               # GitHub CLI for the release-creation step
```

## License

MIT
