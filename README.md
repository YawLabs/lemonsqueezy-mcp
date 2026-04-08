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

## Tools (59)

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

- **Full API coverage** — All 17 LemonSqueezy API resources with 59 tools
- **JSON:API support** — Filtering, pagination, and relationship inclusion on all list/get operations
- **Zero runtime dependencies** — Single bundled file for instant `npx` startup
- **License API** — Activate, validate, and deactivate license keys without an API key
- **MCP annotations** — Every tool declares read-only, destructive, and idempotent hints

## License

MIT
