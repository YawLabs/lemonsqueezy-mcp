# Versioning policy

`@yawlabs/lemonsqueezy-mcp` follows [semantic versioning](https://semver.org). This document defines what each change type means for this package specifically, so callers (especially unattended agents pinned to a version range) know what to expect.

## What the public surface is

Covered by semver from 1.0.0:

- **The MCP tools** (`ls_*`): their names, their input fields and the validation on them, and their MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).
- **Authority classes**: the class names (`read`, `pii`, `mutate`, `money`, `recurring`, `key`, `webhook`) and the class each tool belongs to. The names are the values `LEMONSQUEEZY_DISABLE_CLASSES` and `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS` accept (an unknown one stops the server at startup), and a tool's class decides which of those settings reach it.
- **Guardrail coverage**: which calls the server treats as destructive, and which tools `LEMONSQUEEZY_ALLOWED_STORE_IDS` gates. A call is destructive when `isDestructiveCall(tool, input)` says so: the tool's `isDestructive(input)` predicate decides when the tool has one, and its static `destructiveHint` decides otherwise. Destructive calls are subject to `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` (once the class gate, the refund cap and the per-class limit have let them through), and are always tagged `audit: true` and recorded in `lemonsqueezy://audit-log`. The README's `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` row lists them.
- **The environment variables documented in the README** and the values each accepts, including the launcher's `LEMONSQUEEZY_MCP_RUNTIME`, `LEMONSQUEEZY_MCP_SANDBOX` and `OAM_BIN`.
- **The `lemonsqueezy://audit-log` MCP resource**: its URI and its MIME type (`application/x-ndjson`).
- **Fields this server adds to responses.** Upstream payloads are otherwise passed through as-is. The additions are `effective_unit_price`, `effective_unit_price_note`, `unit_price_is_not_charged` and `unit_price_is_per_package` on price records (in `ls_get_price` and `ls_list_prices` results, and on prices embedded with `include=price` by `ls_get_subscription_item` and `ls_list_subscription_items`), and the `{ "success": true }` body a LemonSqueezy tool returns when a call succeeds with no response body (a 204 No Content, for example).
- **The `lemonsqueezy-mcp` command** and its `version` / `--version` subcommand.

`src/tools/tools.test.ts` pins the class of every one of the 64 tools; the sets of tools that declare `destructiveHint: true`, carry an `isDestructive` predicate, or declare `readOnlyHint: false`; and, case by case, which inputs each predicate counts. Changing a pinned set or the class map fails `npm test` (which `release.sh` runs before every release) with a message asking for the change to be classified here, called out in `CHANGELOG.md`, and reflected in the README in the same change.

## What is a breaking (MAJOR) change

Any of the following ship as a MAJOR bump:

- **Removing or renaming a tool** (`ls_*`).
- **Removing or renaming any input field** on any tool, required or optional. The server drops arguments it does not recognise instead of rejecting them, so a caller still sending the old name gets a call that silently ignores it.
- **Narrowing validation**: rejecting an input value that is accepted today (for example, narrowing a `string` to an enum, or raising a `min`), or rejecting a value that a documented environment variable accepts today (for example, the legacy `json` value of `LEMONSQUEEZY_LOG`, or a `LEMONSQUEEZY_API_KEY_COMMAND` string the current tokenizer runs).
- **Changing a field this server adds to a response incompatibly**: removing or renaming it, or changing its type or meaning.
- **Removing or renaming a documented environment variable** (e.g. `LEMONSQUEEZY_API_KEY`, guardrail vars, `LEMONSQUEEZY_LOG`).
- **Removing or renaming an authority class, or moving a tool to a different class**, in either direction. Operators write `LEMONSQUEEZY_DISABLE_CLASSES` and `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS` against today's classes and today's mapping: a removed name stops the server at startup, and a moved tool is either blocked where it used to pass or let through where the operator meant to deny it.
- **Removing a call from guardrail coverage**: a call that `isDestructiveCall` stops counting as destructive (so the destructive rate limit and the audit log no longer see it), a tool that `LEMONSQUEEZY_ALLOWED_STORE_IDS` stops gating, and the like. An operator who set the variable is relying on it to catch that call.
- **Tightening an MCP annotation**: `destructiveHint` `false -> true`, or `readOnlyHint` `true -> false`. Clients start asking for confirmation on calls they used to run without asking. The same applies to the other two hints in the direction that tells a client to be more careful: `idempotentHint` `true -> false`, `openWorldHint` `false -> true`.
- **Removing or renaming the `lemonsqueezy://audit-log` resource URI**, or changing its MIME type.
- **Raising the minimum Node.js version** (`engines.node`, currently `>=22`) while the Node.js line being dropped is still supported upstream.
- **Loosening audit or log redaction**: printing in clear a value that is masked or redacted today.
- **Removing the `lemonsqueezy-mcp` command** or its `version` / `--version` subcommand.

## What is a MINOR change

- **Adding a new tool.**
- **Adding a new optional input field** to an existing tool.
- **Adding a new optional environment variable**, or a new accepted value for an existing one.
- **Relaxing input validation** (e.g. raising a `max` length).
- **Expanding an existing enum** with new accepted values.
- **Adding a field to a response** alongside the upstream payload.
- **Adding an authority class** that no existing tool moves into.
- **Tightening guardrail coverage**: a call that `isDestructiveCall` newly counts as destructive, or a tool that `LEMONSQUEEZY_ALLOWED_STORE_IDS` newly gates. The release notes call it out, because with the variable set, a call that used to pass can now be rate-limited or blocked.
- **Relaxing an MCP annotation**: `destructiveHint` `true -> false`, `readOnlyHint` `false -> true`, `idempotentHint` `false -> true`, or `openWorldHint` `true -> false`. The release notes call it out. On a tool with no `isDestructive` predicate, `destructiveHint` `true -> false` also takes its calls out of guardrail coverage, which makes that change MAJOR (above).
- **Dropping a Node.js line after its upstream end-of-life**, with `engines.node` bumped and the change called out in the release notes.
- **Adding retry or logging behavior** that is opt-in or does not change success/failure outcomes for previously-working calls.

## What is a PATCH change

- Bug fixes that make behavior match documentation.
- Upstream schema pass-through fixes (unwrapping an error message more clearly, for example).
- Performance improvements.
- Doc / dependency updates with no runtime behavior change.
- **Tightening redaction**: masking or redacting a value that used to appear in clear in log lines or audit entries.

## Specifically not covered by semver

- **Upstream LemonSqueezy API changes.** This package is a thin wrapper over `api.lemonsqueezy.com/v1`. If LemonSqueezy renames a field in a response, our tool result shape changes even though our version does not. Run `npm run test:integration` against a real test-mode store (with `LEMONSQUEEZY_TEST_API_KEY` and `LEMONSQUEEZY_TEST_STORE_ID` set) to catch drift before customers do.
- **Log line schema.** The structured log format written under `LEMONSQUEEZY_LOG` is best-effort stable but not part of the semver contract — downstream log parsers should tolerate added fields. The variable and the values it accepts are covered (above); the shape of each line is not.
- **Audit entry contents** beyond what is listed above. The stderr `tool_call` line and the `lemonsqueezy://audit-log` entry for a call are built from the same object, so audit entries follow the log-line rule. Their `inputs` are redacted on a best-effort basis, and redaction may tighten in any release: a value that used to appear in clear can become masked or `[REDACTED]`, and a newly audited call can have its inputs masked. Loosening redaction is MAJOR (above).
- **Webhook-sink payloads.** The `ls_sink_*` tools return the JSON of the separately versioned [@yawlabs/lemonsqueezy-webhook-sink](https://github.com/YawLabs/lemonsqueezy-webhook-sink) admin API as-is, so its shape follows that package's versioning. The tool names, inputs and annotations, and `LEMONSQUEEZY_SINK_URL` / `LEMONSQUEEZY_SINK_ADMIN_TOKEN`, are covered here.
- **Tool descriptions, annotation `title`s and error message text.** They are written for the model and may be reworded in any release; the behavior they describe is covered where it is listed above.
- **The launcher's minimum oam version.** `OAM_MIN` in `bin/lemonsqueezy-mcp.mjs` may rise in any release, and the release notes will say so. Under the default `LEMONSQUEEZY_MCP_RUNTIME=auto`, an oam below the new floor is passed over and the server runs on a newer oam or on Node (with `LEMONSQUEEZY_MCP_SANDBOX=1` and no usable oam, that means without `--permission`). Under `LEMONSQUEEZY_MCP_RUNTIME=oam` the launcher exits with an error until oam is updated, which is what that setting asks for.
- **The Docker / Containerfile base image and the standalone binaries.**
- **Internal modules**: everything in `src/` (`api.ts`, `wrapper.ts`, `guardrails.ts`, `redact.ts`, `audit-buffer.ts`, `effective-price.ts`, `retry.ts`, `secret.ts`, `logger.ts`, and the helpers the tool modules share) and the internals of `bin/lemonsqueezy-mcp.mjs`. There is no programmatic API: `main` points at the server entry point, which starts a stdio server when it is loaded. The exclusion covers how these modules work, not what they decide: the authority class names, each tool's class, and guardrail coverage are set in `guardrails.ts` and the tool modules, and they are covered as listed above.

## From 1.0.0

Before 1.0.0, a `0.x -> 0.(x+1)` minor bump could carry a breaking change as long as the release notes called it out. `1.0.0` is where the rules above became strict.
