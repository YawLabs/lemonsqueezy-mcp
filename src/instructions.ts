/**
 * The MCP `instructions` string this server sends in its initialize result.
 *
 * Routing guidance only: which credentials each group of tools needs, the ID
 * formats, what the store allowlist does and does not cover, and where the
 * audit log lives. Tool-by-tool detail stays in the tool descriptions.
 *
 * Plain ASCII and under MAX_INSTRUCTIONS_BYTES, because a host may cap it:
 * yaw-mcp sanitises upstream instructions and cuts them at 2000 bytes
 * (src/upstream-instructions.ts, MAX_UPSTREAM_INSTRUCTIONS_BYTES), so anything
 * past that is never seen. src/instructions.test.ts pins both.
 */

/** The ceiling the instructions must stay under, in UTF-8 bytes. */
export const MAX_INSTRUCTIONS_BYTES = 2000;

export const SERVER_INSTRUCTIONS = [
  "LemonSqueezy store management. All tools are prefixed ls_.",
  "Credentials: the management-API tools need an API key (LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_TEST_API_KEY or LEMONSQUEEZY_API_KEY_COMMAND). " +
    "ls_activate_license, ls_validate_license and ls_deactivate_license use the license key you pass instead. " +
    "The ls_sink_* tools need LEMONSQUEEZY_SINK_URL plus LEMONSQUEEZY_SINK_ADMIN_TOKEN and talk to a separate webhook sink, not to LemonSqueezy.",
  "IDs: positive integer strings (e.g. '12345') for every resource except checkouts, whose IDs are UUIDs.",
  "Start with ls_get_user (no arguments) to check the key, then ls_list_stores for store IDs. List tools take filters such as storeId; pass one to keep results to one store.",
  "Store allowlist: when LEMONSQUEEZY_ALLOWED_STORE_IDS is set, tools with a storeId field must name an allowed store, and list-by-parent tools require their parent filter. " +
    "It does not gate tools addressed by a resource ID, ls_list_stores, ls_list_affiliates or the License API tools.",
  "Destructive calls (refunds, cancellations, deletes, archiving, license deactivation, usage records, seat changes and some updates) may be refused by operator guardrails: a refund cap, rate limits, or disabled authority classes. " +
    "A refusal is final for that call; do not retry it in a loop. Every destructive call is recorded in the lemonsqueezy://audit-log resource.",
].join("\n");
