# Changelog

## [Unreleased]

## [0.12.0] — 2026-08-07

### Added
- Runtime launcher at `bin/lemonsqueezy-mcp.mjs`: the published `lemonsqueezy-mcp` command now prefers the [oam](https://oamjs.org) runtime and falls back to Node. `LEMONSQUEEZY_MCP_RUNTIME` selects (`auto` / `oam` / `node`) and `OAM_BIN` overrides discovery. Both paths verified against the MCP surface — handshake plus all 64 tools — and behave identically. The fallback does **not** re-exec Node: npm has already started Node to run the launcher, so it is an in-process `import()` with no extra spawn.

### Changed
- `.gitignore` excludes `bin/*` rather than `bin/`, so the launcher can be re-included with a negation. A negation cannot undo a directory-level exclusion — that trap shipped a broken `bin` in postgres-mcp, where the launcher was untracked and absent from every fresh clone.
- `scripts/build-binary.mjs` pins the CLI source entry instead of deriving it from `bin`'s value, which would have resolved to `bin/lemonsqueezy-mcp.ts` once `bin` moved to the launcher — the breakage postgres-mcp shipped in its 0.9.0.

All notable changes to `@yawlabs/lemonsqueezy-mcp` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versioning follows [SEMVER.md](./SEMVER.md).

## [0.11.1] -- 2026-08-07

### Fixed

- **A 4xx whose error envelope carries no `detail` no longer dumps raw JSON at the caller.** LemonSqueezy's real 404 is `{"jsonapi":{"version":"1.0"},"errors":[{"status":"404","title":"Not Found"}]}` -- `title`, no `detail`. The message chain read `detail` then the License API's bare `error`, so this shape fell all the way through to the raw response body and an agent asking for a missing store got a JSON blob instead of a reason. `title` is now read between the two.

  Long-standing, not new in 0.11.0, and invisible to the unit suite because every fixture in it (and every one added during the 0.11.0 audit) used `detail`. Caught by a read-only call against the live API. Both shapes are now pinned, including the precedence when `detail` and `title` are both present.

## [0.11.0] -- 2026-08-07

### Security

- **`redactSecrets` no longer degrades to exponential traversal on a shared-reference payload.** The cycle guard tracks the ancestor path (entries removed on the way back up) so a merely *shared* object is redacted normally instead of being falsely reported as `[CIRCULAR]` -- but an ancestor set alone is O(paths), not O(nodes). A "diamond chain" holding two references to the same child at every level has 2^depth paths over depth+1 objects: measured at 3.2 seconds for 23 objects, doubling per level, which at the 32-level cap would block the stdio server for the better part of an hour from inside the audit path. A memo of completed subtrees restores linear behaviour. Reuse is gated on the cached entry having been computed with at least as much depth budget as the current position, so a subtree truncated near the cap is never replayed into a shallower slot where real (possibly secret-bearing) input belongs.

### Added

- **`validation_error` log/audit status.** Failure entries previously collapsed client mistakes into `exception`, the same bucket as upstream 5xx and genuine faults. The new `ToolInputError` is tagged `validation_error`, so a log scan at `LEMONSQUEEZY_LOG=error` can separate "an agent sent a malformed request" from "the server or upstream faulted". `guardrail_block` (operator policy refused it) is unchanged.
- **`preflight` hook on the tool contract.** An input-dependent guardrail that runs ahead of the rate limiters. Both refund tools now declare the cap check there, so a rejected over-cap refund no longer consumes the caller's destructive and `money`-class budgets -- previously a client looping on an over-cap amount could exhaust a `money:2/h` allowance on calls that never left the process.
- **Cross-store disclosure on `ls_list_stores`.** It has no `storeId` field and no parent ID to scope by, so `LEMONSQUEEZY_ALLOWED_STORE_IDS` does not gate it and it enumerates every store the API key can see. This was documented in the README but absent from the tool description an agent actually reads. `ls_list_affiliates` carried the note already.

### Fixed

- **Empty-PATCH guards on the remaining three update tools.** `ls_update_customer`, `ls_update_subscription`, and `ls_update_license_key` sent `attributes: {}` upstream when called with only an ID; `ls_update_webhook` had rejected this locally since 0.10.10. All four now reject before the round-trip and throw `ToolInputError`.
- **`ls_update_subscription` and `ls_update_customer` descriptions now disclose their conditional-destructive behaviour.** A tool whose destructiveness depends on the input carries `destructiveHint: false`, because the MCP annotation is static and the verdict is per-call -- so an MCP client will not prompt, and the description is the only signal left. `ls_update_subscription` said nothing about pausing or plan switches; `ls_update_customer` mentioned auditing only to point at `ls_archive_customer`, never saying that setting `status: 'archived'` *here* is itself rate-limited and audited. A new invariant in `tools.test.ts` fails the build if any predicate-carrying tool omits the warning.
- **`Retry-After: " "` no longer means "retry immediately".** `Number("")` is `0`, not `NaN`, so a whitespace-only header fell through the numeric branch and produced a 0 ms wait instead of the 1 s default.
- **`include: ""` no longer emits a bare `?include=`.** The include schemas set `.max()` but no `.min()`, so an empty string is valid input and split to `[""]`.
- **Sink response size limit measures UTF-8 bytes, not UTF-16 code units.** `String.length` undercounts every multi-byte character, so a non-ASCII body could exceed the 10 MB limit while reporting a char count under it -- and the message still said "bytes".
- **A bare `{"error": "..."}` envelope is now read on the management API**, not just the License API, via the shared error handler.
- **A throwing `isDestructive` predicate can no longer escape as an unhandled rejection.** It is evaluated outside the main try block so it stays in scope for the audit path on the error branch; it now has its own guard that fails closed (treats the call as destructive) and logs the fault.

### Changed

- **`apiRequest` and `licenseRequest` share one error path and one 2xx body reader.** Roughly 90 lines of near-identical parse/log/decorate logic collapsed to two helpers. `licenseRequest` still deliberately does not bust the API-key cache on 401, since it authenticates with the caller's license key rather than `LEMONSQUEEZY_API_KEY`.
- **Both generate-invoice tools share one query builder** (`buildInvoiceQuery`) instead of duplicating an eight-field `URLSearchParams` block.
- **Cross-store notes are generated from each module's `requiredFilters` array**, so the disclosure and the runtime gate cannot drift apart.
- **`src/index.ts` is free of top-level await.** The version fallback used `await import("node:module")`, which the CJS single-binary build cannot emit; it survived only because both builds define `__VERSION__` and esbuild constant-folded the branch away. A static `createRequire` import removes the dependency on that folding -- verified by bundling to CJS with the define absent.

### Added

- **Opt-in [oam.js](https://oamjs.org) build tooling.** `npm run check:oam` type-checks via `oam check` (tsgo, TypeScript 7 native) -- 2878ms against 4406ms for `tsc --noEmit`, same clean result. `npm run build:binary:oam` builds the standalone binary via `oam compile` instead of the Node SEA path, writing to the same `bin/<platform>-<arch>/` location so the release staging script consumes either unchanged. Neither touches the published npm package.

  **Node remains the default runtime.** oam runs the server unmodified (verified against 0.8.2: full handshake, all 64 tools, the audit-log resource, working `fetch`, guardrail errors identical to Node), but cold start measured 196ms for Node against 424ms for `oam run` -- and since an MCP client pays startup once per session, that is the cost that matters. oam is also not distributed on npm, so defaulting to it would break `npx` for anyone without it. `src/` stays runtime-agnostic (no `oam:` imports, tests on `node:test`) so the Node path remains a real fallback rather than a nominal one.

- `oam/` added to `.gitignore` -- any `oam` invocation writes a bytecode cache there.

### Documentation

- `0` documented as a valid value for the refund cap and both rate limits (blocks everything; unset/empty means no limit).
- `LEMONSQUEEZY_LOG` row now lists what each failure `status` means.
- README's allowlist row no longer describes `ls_list_stores` as routing "by its own resource ID"; the two genuinely ungated list tools are called out separately from the ID-targeted ones.

## [0.10.13] -- 2026-06-11

### Added

- **Cross-platform single-binary pipeline** (Scoop + Homebrew) via `scripts/build-binary.mjs` and `scripts/stage-release-asset.mjs`.

### Fixed

- **`npm test` runs every test file under POSIX sh**, not only nested ones -- an unquoted `**/*` glob skipped the top-level files.

### Changed

- Node engine requirement raised to `>=22`; dev-dependency vulnerabilities cleared.

## [0.10.12] -- 2026-06-02

### Fixed

- **Release drift guard compares tag-object SHAs**, so resuming a partial release no longer false-aborts.
- **`SKIP_LINT=1` escape hatch** for environments where the lint runner itself is broken.
- **`release.sh` refuses to push if origin's tag drifted from local.**
- README "Add to Yaw MCP" badge points at the https forwarder.

### Added

- End-to-end coverage for the refund-cap guard on both refund tools.

## [0.10.11] -- 2026-05-28

### Changed

- **MCP Registry publish folded into `release.sh`**; `release.yml` and the remaining non-release workflows removed. `release.sh` is now the only release path.

### Fixed

- Confirmation prompt is tty-gated, so non-interactive runs no longer block.
- `server.json` syncs unconditionally rather than only inside the version-bump branch.
- Falls back to the `gh` auth token for MCP Registry authentication.

## [0.10.10] -- 2026-05-22

### Fixed

- **`release.sh` no longer demands a workstation npm session for CI-publish flows.** The pre-flight `npm whoami` gate was a vestige of the local-only-deploy era (added in `53de878`); when CI publishing was restored in `e3ef87a` the gate was kept but the publish itself moved to CI's org-level `NPM_TOKEN`, so the workstation never uses that credential. Blocked the v0.10.10 release attempt with "npm is not authenticated" despite the intended publish path not needing it. Mirrors `tailscale-mcp/release.sh`, which never had the gate.

### Security

- **Webhook `url` restricted to http/https schemes.** `ls_create_webhook` and `ls_update_webhook` previously accepted any string up to 10k chars; `z.string().url()` alone would have additionally accepted every URL-parseable scheme (`mailto:`, `file:`, `javascript:`, `ftp:`, `chrome-extension:`, ...). Anything non-http(s) stored as a webhook target is unreachable in the best case and an injection sink in the worst. The new `httpsUrlSchema` chains `.url()` with a `.refine()` enforcing `^https?://`, applied on both tools.
- **`ls_update_webhook` secret rotation gated as destructive.** Rotating the signing secret silently breaks signature verification on every receiver until they redeploy with the new value. The tool now declares an `isDestructive` predicate flagging any `secret` change, routing those calls through `checkDestructiveRateLimit` + audit logging via the wrapper's existing duck-typed integration. URL and events changes stay on the regular path.

### Changed

- **`ls_update_webhook` rejects empty PATCH locally.** Calling with only `webhookId` and no fields to change previously sent an empty `attributes: {}` PATCH that the API would 422 with a less clear message. The handler now throws `"ls_update_webhook requires at least one of: url, events, secret"` before the round-trip.
- **`ls_update_webhook` description warns about secret rotation.** The tool-level description now calls out that setting `secret` is destructive (rate-limited and audited) so LLM callers see the consequence before invoking.

### Tests

- **Regression coverage for the `events.min(1)` fix** (`f7374bd`): schema-rejection tests on both `ls_create_webhook` and `ls_update_webhook` lock in the empty-array rejection.
- **URL validation coverage**: non-URL string rejection on both tools, four non-http(s) schemes (`mailto:`, `file:`, `javascript:`, `ftp:`) rejected on both tools, http and https explicit acceptance.
- **`ls_update_webhook` predicate tests** mirror the `ls_update_license_key` shape: secret-only as destructive, url-only and events-only as non-destructive, empty input as non-destructive.
- **`ls_update_webhook` URL-encoding** test added in parallel to the existing `ls_delete_webhook` coverage.
- **Handler-side empty-PATCH rejection** test asserts the new error message.

## [0.10.9] -- 2026-05-22

### Changed

- **Webhook `events` array now requires at least one entry.** `ls_create_webhook` and `ls_update_webhook` previously let an empty array pass local Zod validation, so a no-op webhook configuration only failed at the LemonSqueezy API as a 422. The new `.min(1)` makes the rejection local with a clearer message; on update, the field stays optional but, when supplied, must be non-empty.

## [0.10.8] -- 2026-05-19

### Security

- **Sink response body size guard extended to the error branch.** `sinkRequest` in `src/tools/sink.ts` previously only size-checked 2xx response bodies; a misbehaving sink returning a giant 4xx/5xx body could still buffer the whole thing into memory before any limit fired. A new `readBodyOrSizeError` helper pre-checks `Content-Length` against the 10 MB cap and is applied to both the error and success branches. The post-read length check on the 2xx path is retained as belt-and-braces against a lying `Content-Length`.

### Changed

- **2xx body-read mid-stream failures now collapse to the uniform `{ ok: false, error }` shape.** Previously a socket reset partway through reading the body propagated as an exception out of `sinkRequest`, surfacing as a less-informative error via the wrapper's catch-all. The 2xx body read is now wrapped in a try/catch that returns `Sink response body read failed: <message>` -- consistent with every other failure mode in the function.
- **`src/secret.ts` cache-hit branch tightened.** The test-mode cache-hit branch previously called `announceTestModeOnce()` redundantly (the flag is set on the first miss, so the cache-hit call was dead). Removed the call and the now-obsolete defensive comment.

### Tests

- **Sink coverage expanded** to pin `authorityClass` per tool (`read` for `ls_sink_events_list` / `ls_sink_stats`, `mutate` for `ls_sink_event_mark_processed`), 4xx-oversized-Content-Length, 2xx-lying-Content-Length, and 2xx mid-stream body-read failures. `stubFetch` gained an optional `responseHeaders` field so error-branch tests no longer override `globalThis.fetch` inline.
- **`parseCommand` contract pinned** in `src/secret.test.ts` for the four tokenizer edges that the rest of the suite only touched by accident: unterminated quote, all-quotes-collapse-to-empty, quoted-args-with-spaces (both quote styles), and quote-then-bare-word concatenation. Also added a 64 KB `maxBuffer` overflow test that exercises the `execFile` `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` rewrap path.

## [0.10.7] -- 2026-05-16

### Security

- **Allowlist-bypass surface closed at the test layer.** `checkStoreScopedToolInput` in `src/wrapper.ts` enforces `LEMONSQUEEZY_ALLOWED_STORE_IDS` by reading the literal input field name `storeId` from the tool's Zod shape. Today every list tool that filters by store happens to use that name, but the convention wasn't asserted anywhere -- a future tool whose filterMap mapped a differently-named input (e.g. `store`) to `filter[store_id]` would silently bypass the allowlist. `src/api.ts` `listHandler` now exposes its `filterMap` on the returned handler, and `src/tools/tools.test.ts` adds an invariant that fails CI for any drift between the filter key (`store_id`) and the input field name (`storeId`).

### Changed

- **`wrapper.ts` skips the success/error entry literal when no consumer wants it.** A non-destructive read at `LEMONSQUEEZY_LOG` unset (i.e. "off") previously built a full audit entry on every call, then `logEvent` discarded it inside its level check. Now the wrapper consults `wouldLogToolCall({ isDestructive, isError })` -- a new export from `src/logger.ts` -- before allocating. Destructive calls always build the entry because the audit-buffer push is independent of the log level. No observable behavior change; saves a small object literal per non-destructive read on the most common configuration.

## [0.10.6] -- 2026-05-16

### Security

- **Sink response body size cap.** `sinkRequest` in `src/tools/sink.ts` now rejects responses larger than 10 MB before calling `JSON.parse`, defending the in-process MCP server against CPU exhaustion from a malicious or misconfigured sink (`Sink response body too large: X bytes exceeds Y byte limit`). The 10 s `AbortSignal` timeout already bounded wall-clock; the size cap bounds the parse cost as well.

### Changed

- **`buildQuery` page-param values are URL-encoded.** Brought `page[number]` / `page[size]` in line with the `include` / `filter` branches (which already wrapped values in `encodeURIComponent`). Today the Zod schemas constrain both to integers so the encoding is a no-op, but if pagination ever widens to accept a string cursor the values are already safely escaped.
- **`smithery.yaml` numeric fields are typed `integer`.** `lemonsqueezyMaxRefundAmountCents` and `lemonsqueezyDestructiveRateLimit` now declare `type: integer, minimum: 1` (were `type: string`). Smithery's config UI now renders a number input with client-side validation. The `commandFunction` `String(...)` coerces back to env-var form, and the truthy check switched to `!= null` so the (admittedly nonsensical) value `0` would not be silently dropped.

### Docs

- **`CHANGELOG.md` em-dashes normalized to ASCII `--`** throughout v0.9.3 and earlier sections. Brings older entries in line with the v0.10.x style and avoids the Windows-terminal mojibake risk called out in the Yaw Mode discipline.

## [0.10.5] -- 2026-05-16

### Changed

- **`release.sh` step 3 now bumps `server.json` alongside `package.json` and stages it in the release commit.** Previously `server.json` was treated as a derived artifact only -- `release.yml` ran a `jq` step at publish time to sync `version` and `packages[0].version` from `$GITHUB_REF_NAME`, but the committed file was never updated, so a manual `mcp-publisher publish` outside CI would push a stale registry version. The new `node -e` step mirrors the CI `jq` so the committed source matches the latest published version on every release. No `jq` dependency added (`node` was already a release-flow prereq).
- **`server.json` resynced to 0.10.4** to clear the existing drift (file was last touched at 0.10.0; releases 0.10.1 through 0.10.4 all relied on CI's publish-time `jq` rewrite). 0.10.5 going forward, the workstation release path keeps it current automatically.

### Docs

- **CHANGELOG footers backfilled** for v0.10.0 through v0.10.4. Adds the missing `[X.Y.Z]: .../compare/...` lines per Keep a Changelog and points `[Unreleased]` at `v0.10.4...HEAD` (previously stuck at `v0.9.3...HEAD`).

## [0.10.4] -- 2026-05-16

### Changed

- **GitHub release notes now come from `CHANGELOG.md`, not just commit subjects.** `release.sh` step 6 extracts the section between `## [X.Y.Z] -- ...` and the next `## [` and passes that body to `gh release create --notes`. Falls back to the previous `git log --oneline` behavior if no matching section is present (or the section is whitespace-only), then to "Initial release". Removes the long-standing pattern of single-line "- vX.Y.Z" release bodies on the GitHub releases page (every 0.10.x release until this one).

## [0.10.3] -- 2026-05-16

### Fixed

- **Startup env-var parse errors now print a single line, not a stack trace.** The 0.10.1 eager-parse of `LEMONSQUEEZY_DISABLE_CLASSES` / `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS` / `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` threw an uncaught `Error`, so operators saw Node's stack dump before the helpful message. `src/index.ts` now wraps the call in try/catch and exits 1 with just the error message -- e.g. `LEMONSQUEEZY_DISABLE_CLASSES contains unknown class "mony" (expected one of: read, pii, mutate, money, recurring, key, webhook)`.

## [0.10.2] -- 2026-05-16

### Changed

- **`CHANGELOG.md` is now included in the published npm tarball.** Added it to `package.json`'s `files` array. npm auto-includes `README` and `LICENSE` regardless of the allowlist, but `CHANGELOG.md` is not in that auto-include set -- so prior versions shipped without it, and an operator inspecting `node_modules/@yawlabs/lemonsqueezy-mcp` had no in-package changelog. The README and bundle are unchanged; tarball size grows by ~29 kB.

## [0.10.1] -- 2026-05-16

### Fixed

- **`smithery.yaml` now exposes the sink-bridge env vars.** Added `lemonsqueezySinkUrl` and `lemonsqueezySinkAdminToken` to `configSchema.properties` and forwarded them in `commandFunction`. Without this, Smithery-installed instances could not configure the 0.10.0 `ls_sink_*` tools and they always returned "not configured".
- **Guardrail env vars are now parsed at server boot, not first call.** A new `loadGuardrailOptions()` export is invoked from `src/index.ts` before stdio connect, so a typo'd `LEMONSQUEEZY_DISABLE_CLASSES`, malformed `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS`, or non-numeric `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` crashes the process at startup. Previously the parse was lazy and a misconfigured deployment booted cleanly, passing liveness probes, and only surfaced the error on the first tool invocation.

## [0.10.0] -- 2026-05-15

### Added

- **Webhook-sink bridge tools** for the optional [@yawlabs/lemonsqueezy-webhook-sink](https://github.com/YawLabs/lemonsqueezy-webhook-sink) process. Three new tools give an agent a unified read surface for "what webhooks have actually fired" alongside the existing management-API reads:
  - `ls_sink_events_list` -- list received webhook events with optional `since` / `type` / `limit` filters
  - `ls_sink_event_mark_processed` -- idempotent ack from your consumer
  - `ls_sink_stats` -- total, unprocessed, last-received timestamp
- `LEMONSQUEEZY_SINK_URL` and `LEMONSQUEEZY_SINK_ADMIN_TOKEN` env vars to configure the bridge. Tools are always registered for `tools/list` discovery; missing env vars surface at call time as a structured "not configured" error (with a pointer to the sink repo), not a registration-time failure. 10s fetch timeout via `AbortSignal.timeout()`; auth failures (401), admin-disabled (404), and transport errors each get a tailored diagnostic.

## [0.9.3] -- 2026-05-15

### Fixed

- `server.json` rewritten against the current registry schema (`2025-12-11`). The 0.9.2 release's MCP-Registry publish step failed validation against the live schema: `description` exceeded the 100-char cap, the package field was `registry_type` (snake_case) where the schema expects `registryType` (camelCase), and the required `packages[].transport` field was missing. 0.9.2 is live on npm and GitHub but did not reach the Official MCP Registry. 0.9.3 is the first release that should land on `registry.modelcontextprotocol.io`.

## [0.9.2] -- 2026-05-15

### Added

- `.github/workflows/release.yml` now publishes to the [Official MCP Registry](https://registry.modelcontextprotocol.io) after the post-publish smoke test passes. Authentication is via GitHub OIDC -- the `id-token: write` permission already enabled for npm provenance also satisfies the registry's auth; no `MCP_*` secret is required. The namespace `io.github.YawLabs/*` is authorized purely from the OIDC `repository_owner` claim, so anyone outside the YawLabs GitHub org cannot publish under it. A `jq` step overwrites `server.json`'s `version` (and `packages[0].version`) from the pushed tag, so a forgotten manual bump on `server.json` no longer publishes a stale version to the registry. Downstream registries (Glama, PulseMCP, mcpservers.org) that auto-source from the official registry now pick up each `@yawlabs/lemonsqueezy-mcp` release without a manual mcp-publisher run.

### Docs

- README Resources section now spells out the full redaction policy (every secret-named key the regex matches, plus JWT-shaped string values), so an operator who sees a `[REDACTED]` under an innocuous key knows where it came from.
- README Development section documents `npm run gen:containerfile` / `npm run check:containerfile` so a contributor editing `Dockerfile` knows to regenerate.
- README Releasing section notes that the local `./release.sh` path does not publish to the Official MCP Registry (CI-only) and gives the manual `mcp-publisher` commands as the fallback when a release is cut without CI.

## [0.9.1] -- 2026-05-15

### Docs

- README "Features" list now mentions authority-class disable, per-class rate limits, and the audit-log MCP Resource -- previously omitted under the umbrella "Guardrails" bullet despite being documented in detail later in the file.
- README description of `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` now lists every destructive trigger the runtime classifier counts: `ls_update_license_key` calls that change `activationLimit` (added in 0.7.1), `ls_update_customer` calls with `status: "archived"`, plus the previously-documented pause/plan-switch and `disabled: true` paths.
- README qualifies the "issue a scoped LemonSqueezy API key" recommendation. LS API keys are account-wide; the qualifier directs readers to LS team-membership scoping where it exists and treats the env-var guardrails as the primary control surface for what LS itself can't express (per-class rate ceilings).

### Changed

- `audit-buffer.ts` overflow path is now O(1) (circular index) instead of O(N) (`Array.splice(0, …)`). No observable behavior change; the buffer caps at 1000 entries and presents the same most-recent-first read order.
- `src/index.ts` split -- the registered MCP tool wrapper and the audit-log Resource read-callback now live in `src/wrapper.ts` so unit tests can exercise them end-to-end without starting the stdio MCP server. `src/index.ts` becomes a thin entry point that imports `createToolHandler` and `readAuditLogResource` from the new module. No observable behavior change in the published binary.
- `secret.ts` cache fingerprint no longer embeds the raw API key. The fingerprint is now a SHA-256 digest of `mode:value`, preserving the mid-process change-detection semantics while removing the only in-memory copy of the key outside the `cached.key` field itself.
- `redact.ts` now also masks any string value matching the LemonSqueezy bearer-token shape (`eyJ…`-style JWT prefix), even when the key name is innocuous. Closes the future-feature gap where a destructive tool accepts a `customData`/`metadata` object whose values happen to contain a key. Also covers additional credential / PII key names (`private_key`, `pin`, `ssn`, `social_security_number`, `credit_card`, `card_number`, `cvv`, `cvc`).

### Fixed

- Smithery one-click install now exposes `LEMONSQUEEZY_DISABLE_CLASSES` and `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS` -- the two env vars added in 0.9.0. Previously a Smithery user had to hand-edit the spawned process env to reach the authority-class layer.
- Smithery description for `lemonsqueezyDestructiveRateLimit` now states the actual format (a positive integer interpreted as calls per 60-second rolling window) instead of "Format depends on server defaults."
- `logger.ts` JSON-stringify fallback now coerces `entry.error` to a plain string before the second serialization pass, so a non-string error field (an `Error` with a circular `cause` chain, or an object with a throwing `toJSON`) no longer skips both write attempts and degrades to silence. Tests cover the case.
- `integration.test.ts` `before()` hook now clears `LEMONSQUEEZY_API_KEY_COMMAND` and `LEMONSQUEEZY_TEST_API_KEY` before setting `LEMONSQUEEZY_API_KEY` from the test key, and resets the secret cache. Previously a developer with a vault-backed `LEMONSQUEEZY_API_KEY_COMMAND` would silently run the integration suite against their dev key, because the command takes precedence over the bare env var in `secret.ts`.
- `Containerfile` is now generated from `Dockerfile` via `scripts/sync-containerfile.mjs`. `npm run check:containerfile` (called by `release.sh` and CI) verifies the two stay in sync; `npm run gen:containerfile` regenerates. Removes the byte-identical-but-not-actually drift surface where editing one file silently left the other behind.

### Added

- `src/wrapper.ts` -- extracted production module containing `createToolHandler` (the MCP tool registration wrapper) and `readAuditLogResource` (the audit-log Resource read-callback). Same logic that previously lived inline in `src/index.ts`; now reusable and testable.
- `src/wrapper.test.ts` -- end-to-end test that exercises the registered MCP tool wrapper from `src/wrapper.ts`. Covers the order in which `checkClassAllowed` / `checkClassRateLimit` / `checkDestructiveRateLimit` / `checkStoreScopedToolInput` fire, the destructive-call audit pipeline (logger + ring buffer), the audit-log MCP Resource (`lemonsqueezy://audit-log`), and the predicate-destructive routing (e.g. `ls_update_license_key` with `activationLimit`). Previously every handler test invoked `tool.handler(input)` directly and the wrapper was untested.

## [0.9.0] -- 2026-05-14

### Added

- **Authority classes.** Every tool now declares an `authorityClass` describing the kind of business authority a caller needs to invoke it (`read`, `pii`, `mutate`, `money`, `recurring`, `key`, `webhook`). The class is separate from the existing destructive/read-only annotation.
- `LEMONSQUEEZY_DISABLE_CLASSES` -- comma-separated list of classes to refuse outright. Example: `money,recurring,pii` lets an agent run reads but blocks refunds, subscription changes, and customer-record access. Unknown class names throw at server startup.
- `LEMONSQUEEZY_RATE_LIMIT_PER_CLASS` -- per-class rolling rate limits with a DSL. Each entry is `class:N`, `class:N/m`, or `class:N/h`. Example: `money:2/h,recurring:5/h,key:10/m`. Composes with `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` -- both must pass. No LemonSqueezy permission can express "max 2 refunds per hour"; this is the only place that policy can live.
- `deprecate.yml` workflow -- CI-driven `npm deprecate` via `workflow_dispatch`, using the org-level `NPM_TOKEN` and the same `release-npm` concurrency group as `release.yml`. No local WebAuthn session needed for a deprecate run.
- `server.json` + `mcpName` field in `package.json` -- prepares the repo for the Official MCP Registry. Downstream registries (Glama, PulseMCP, mcpservers.org) auto-source from the official registry, so a single publish reaches the ecosystem.
- README "Add to mcp.hosting" install button -- one-click sync of the server into [mcp.hosting](https://mcp.hosting) so it propagates to every MCP client a user has configured.

### Changed

- README "Authority classes" section reframed to lead with the authoritative control (a scoped LemonSqueezy API key) and present the env vars as defense in depth. `RATE_LIMIT_PER_CLASS` is called out as load-bearing (no LS access-control equivalent); `DISABLE_CLASSES` is positioned as a fast deploy-time alternative when the cost of a key rotation outweighs the strength gained.
- `release.yml` smoke test now retries the actual `npx --version` call (30 × 10s) instead of gating on `npm view`. The two paths hit different CDN caches; `npm view` can clear while `npx` still ETARGETs on a stale mirror. Mirrors the pattern in `aws-mcp` / `tailscale-mcp`.

## [0.8.1] -- 2026-05-13

### Fixed

- `handlers.test.ts` isolation: CI's integration job sets `LEMONSQUEEZY_TEST_API_KEY` from a repo secret. With the priority chain introduced in 0.8.0 (`COMMAND` > `TEST_API_KEY` > `API_KEY`), that injected value took precedence over the in-test stub and broke three handler tests (`ls_get_user` bearer-token assertion plus the missing/empty-key cases). The suite-level `before()` now saves and clears all three source env vars, restores them in `after()`, and resets the secret cache. Reproducible locally by running with `LEMONSQUEEZY_TEST_API_KEY=ci-stub-key LEMONSQUEEZY_API_KEY="" npm test`.

## [0.8.0] -- 2026-05-13

Distribution-readiness pass -- closes feature gaps against other OSS LemonSqueezy MCP servers ahead of broader distribution.

### Added

- **Smithery one-click install.** `smithery.yaml` declares the stdio start command + JSON Schema for env vars; Smithery generates the config UX. Install via `npx -y @smithery/cli install @yawlabs/lemonsqueezy-mcp --client claude`.
- **Container images.** `Dockerfile` + `Containerfile` + `.dockerignore`. Multi-stage build on `node:20-alpine`, runs as the non-root `node` user, copies only `dist/index.js` into the runtime image. Stdio transport; no port exposed. Pass env via `-e LEMONSQUEEZY_*`.
- `LEMONSQUEEZY_TEST_API_KEY` -- separate test-mode key. Priority sits between `LEMONSQUEEZY_API_KEY_COMMAND` (highest) and `LEMONSQUEEZY_API_KEY` (lowest), so a developer can point the server at a sandbox store without unsetting their production key. A one-shot stderr `test_mode` notice fires on first activation per process.
- **MCP Resource `lemonsqueezy://audit-log`** -- bounded ring buffer (last 1000 entries, most-recent-first) of destructive-call audit entries, exposed as `application/x-ndjson`. Lets clients without stderr access retrieve the audit trail structurally. Secret-shaped input fields are already redacted before they reach the buffer.

### Changed

- Dev-dependency audit warnings cleared via `npm audit fix`. Runtime bundle is unaffected (zero runtime deps).

## [0.7.1] -- 2026-05-13

Hardening pass on the v0.4.0 guardrails after observing realistic agent failure modes.

### Added

- **Retry deadline.** `OVERALL_DEADLINE_MS=90s` ceiling on total wall clock across retries. The timeout error reports actual elapsed and attempt count (`Request timed out after Xs (N attempts)`) instead of the per-attempt budget. The loop stops on 5xx/429/timeout once the deadline is reached rather than starting a new attempt or sleeping past it.
- **Audit redaction (`src/redact.ts`).** Masks values of secret-shaped keys (`secret`, `password`, `token`, `api[_-]?key`, `bearer`, `authorization`, `signing[_-]?secret` -- case-insensitive, whole-word) before the entry reaches the audit log. Anchored regex so business identifiers (`licenseKey`, `instanceId`, `storeId`) are preserved. Cycle-safe via `WeakSet` with a 32-depth cap. Defense in depth -- no destructive tool today carries a secret-typed input, but flipping any webhook tool to destructive would otherwise leak its signing secret.
- **`requiredFilters` scoping.** When `LEMONSQUEEZY_ALLOWED_STORE_IDS` is active, list tools that lack a `storeId` field must specify at least one parent filter (orderId, productId, variantId, etc.). Closes the silent-no-op gap on `ls_list_files` / `ls_list_prices` / `ls_list_variants` / `ls_list_order_items` / `ls_list_subscription_items` / `ls_list_usage_records` / `ls_list_discount_redemptions` / `ls_list_license_key_instances`. Each affected tool description flags the cross-store consideration. `ls_list_affiliates` has no meaningful parent filter and is description-only.

### Changed

- `ls_update_license_key` is now classified as destructive whenever `activationLimit` changes, not just when `disabled: true`. Shrinking the limit can revoke access and the input alone doesn't reveal shrink-vs-grow direction.
- `ls_create_checkout` email validation tightened to `.email().max(320)` to match `ls_create_customer` (was `max(10000)` with no shape check).

## [0.7.0] -- 2026-05-06

### Added

- `LEMONSQUEEZY_LOG=audit|error|all` -- fine-grained log levels for long-running deployments. `audit` keeps destructive-call entries plus errors and drops successful reads (recommended for production where log volume matters over weeks). `error` keeps only failures. `all` is the verbose default. `json` is retained as a backwards-compat alias for `all`.

### Changed

- Tool ID validation now uses a shared `lsIdSchema` (numeric string regex) so a typo fails at the schema layer with a clear message instead of as an opaque 422 from the upstream API.
- `ls_update_customer.status` tightened to `z.literal("archived")` so the destructive predicate cannot be side-channeled by an unrecognized status string.
- Secret cache refactored to a fingerprint-keyed entry. `invalidateApiKeyCache()` (called from `api.ts` on 401/403 responses) now behaves uniformly across the env, test, and command source modes. A rotated upstream key picks up on the next request without waiting on the 1h TTL.
- Integration-test unique suffix switched from a timestamp slice to `crypto.randomUUID().slice(0, 8)`. Two overlapping CI runs (nightly + `workflow_dispatch`) that started in the same millisecond no longer collide on resource naming.

### Fixed

- `release.sh` annotated tags (`git tag -a`) -- `git push --follow-tags` silently skips lightweight tags. Pre-0.7.0, the release commit could push without the tag, leaving CI release unfired. Caught by review before any failed run.
- `release.sh` idempotency check now queries `@yawlabs/<pkg>@${VERSION}` specifically rather than the package's `latest` dist-tag. The bare query returned whichever version is latest on the registry, so an out-of-band higher version made the script try to re-publish the current one and fail with "cannot publish over previously published version." The versioned form returns the version when it exists and empty otherwise -- correct idempotency semantics.
- `release.sh` push now uses `--follow-tags` instead of `--tags` so stale local tags don't ride along (`--tags` pushes every local tag).
- `release.yml` concurrency group is now a literal `release-npm` (workflow-scoped); previously `release-${{ github.ref }}` evaluated to per-tag groups and back-to-back tag pushes would race on `npm publish`.
- `ci.yml` no longer runs a redundant explicit `npm run build` step -- `npm test` is `npm run build && node --test dist/...` for this dist-based repo, so the explicit step was building twice per matrix cell for zero signal.

### Restored

- `CODEOWNERS` and `dependabot.yml` (dropped along with the workflows in 0.6.0; restored when the workflows came back in 0.6.1). Routes review requests to `@jeffyaw` and bumps npm deps weekly / github-actions deps monthly.

## [0.6.2] -- 2026-05-04

### Changed

- `release.yml` now runs a post-publish smoke test that fetches the just-published tarball via `npx -y @yawlabs/lemonsqueezy-mcp@<version> --version` and asserts the binary executes and prints the expected version. Catches packaging regressions (missing bin shebang, broken `files` entry, bad esbuild output) before they reach real users.
- `release.sh` step 7 now verifies that CI publishes carry a sigstore provenance attestation. A missing attestation in CI mode is a soft warning; local publishes legitimately skip provenance.

## [0.6.1] -- 2026-05-04

### Changed

- Restored CI release plumbing (`ci.yml`, `integration.yml`, `release.yml`) ported from `tailscale-mcp`. Tag-and-let-CI is the preferred release path; local `release.sh <version>` still works for end-to-end runs from the workstation.
- `release.sh` gained a CI mode that derives version from `$GITHUB_REF_NAME`, skips local-only gates, and publishes with `--provenance`.

### Fixed

- `integration.yml` now requires both `LEMONSQUEEZY_TEST_API_KEY` and `LEMONSQUEEZY_TEST_STORE_ID` together. A half-configured repo previously ran the workflow successfully with every integration suite silently skipped, masking zero coverage as green CI.
- `release.sh` CI mode now hard-fails when `package.json` disagrees with the pushed tag instead of bumping inside the ephemeral checkout, which would have published the right version while leaving `main` pointing at the old one.
- `release.sh` `npm publish` retry only fires on EOTP/EAUTH/OTP messages. Other failures (duplicate-version E403, packaging errors) bail immediately instead of wasting 60s in the retry loop.
- `package.json` `prepublishOnly` trimmed to `npm run build`. `release.sh` already runs lint + tests before publishing in both modes, so the embedded test run was doubling the CI work per release.

## [0.6.0] -- 2026-04-24

### Changed

- **Breaking.** `LEMONSQUEEZY_ALLOWED_STORE_IDS` now requires `storeId` on list tools that accept it as a filter (`ls_list_orders`, `ls_list_subscriptions`, etc.). Previously the allowlist was silently bypassed when callers omitted the optional filter, returning data from every store the API key could see. Callers that relied on the unfiltered behavior must now pass an allowed `storeId` explicitly.
- `ls_update_license_key` calls that set `disabled: true` are now classified as destructive at runtime, so revocations engage `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` and the audit log. Benign edits (expiry, activation limit) stay on the regular path.
- `ls_update_subscription` rejects non-numeric `variantId` at the schema level instead of producing `NaN` upstream.
- `release.sh` rewritten as a local-only, idempotent deploy with branch and auth pre-flight, EOTP retry on `npm publish`, and clearer failure messages. Re-running with the same version after a partial failure resumes from where it stopped.

### Fixed

- Path segments are URL-encoded across `getHandler` and every inline tool handler via a new `encodePath()` helper, closing a path-injection surface where IDs containing `/` could target adjacent endpoints.
- Logger emits a degraded fallback entry on `JSON.stringify` failure so destructive-call audit trails survive circular inputs.
- Checkout `billing_address` composition is now order-independent.
- Integration test env mutation moved from module-eval to a `before()` hook.

### Removed

- All of `.github/` (workflows, dependabot, CODEOWNERS). There is no CI -- `release.sh` is the only supported release path.
- `test:ci` npm script.

### Docs

- README documents the local release flow and the one-time `npm login` / `gh auth login` setup.
- README clarifies `LEMONSQUEEZY_ALLOWED_STORE_IDS` semantics -- list filters now required when the allowlist is set; tools with no `storeId` field at all remain ungated, so pair with the refund cap and rate limit.
- README notes that `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` counts include `ls_update_license_key` with `disabled: true`.
- `SEMVER.md` points at `npm run test:integration` for upstream-drift detection instead of the removed nightly workflow.
- `CLAUDE.md` and `CONTRIBUTING.md` updated to reference the local script and Biome-on-review instead of CI checks.

## [0.5.0] -- 2026-04-23

### Changed

- **Breaking.** `ls_update_webhook` now validates `secret` as `min(6).max(40)`, matching `ls_create_webhook`. Previously accepted any string up to 10,000 chars. Callers passing secrets outside the 6-40 range will now be rejected at the MCP boundary.
- **Breaking.** Email fields across `ls_list_customers`, `ls_create_customer`, `ls_update_customer`, `ls_list_orders`, and `ls_list_subscriptions` now validate as RFC email (`z.string().email().max(320)`), matching the existing `ls_list_affiliates` filter. Non-email inputs (partial matches, malformed addresses) will now be rejected at the MCP boundary.
- `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` guardrail now also applies to `ls_refund_subscription_invoice`, closing a gap where the cap only gated `ls_refund_order`.
- `ls_update_subscription` `trialEndsAt` is now `.nullable()` at the schema level. The description always promised `null` ends the trial immediately; the type now supports it.

### Fixed

- Integration test env-var restoration now runs in a top-level `after()` hook instead of at module scope, so `LEMONSQUEEZY_API_KEY` stays set to the test key for the duration of the test run. Previously a developer with both `LEMONSQUEEZY_API_KEY` (prod) and `LEMONSQUEEZY_TEST_API_KEY` set could have their prod key used against the test store.

### Docs

- README tool count corrected from 59 to 61 (affiliate tools from 0.3.0 plus `ls_refund_subscription_invoice` weren't reflected in the total).

## [0.4.1] -- 2026-04-20

### Security

- Override transitive `hono` to `^4.12.14` to clear Dependabot advisory on `hono/jsx` SSR. Not exploitable in this package (MCP does not use `hono/jsx`), but closes the supply-chain scan signal.

### Docs

- README links to `@yawlabs/lemonsqueezy-webhook-sink` from the webhook-reconciliation callout.

## [0.4.0] -- 2026-04-20

Hardening pass for unattended automation against live billing flows.

### Added

- **Guardrails.** Opt-in controls evaluated in a single dispatcher pre-check:
  - `LEMONSQUEEZY_ALLOWED_STORE_IDS` -- allowlist enforced on every tool call that names a store.
  - `LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS` -- per-call cap on `ls_refund_order` to prevent runaway agents from issuing large refunds.
  - `LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT` -- rolling 60-second circuit breaker on destructive tool calls.
  All three default to unset → disabled, so existing integrations are unaffected until explicitly opted in.
- **Retry layer** (`src/retry.ts`). Exponential backoff with jitter, capped at 4 attempts and 30s. Retries `429` always (honors `Retry-After`), `5xx` and transport errors only on idempotent methods (`GET`/`DELETE`). Non-idempotent writes fail fast.
- **Secret loader** (`src/secret.ts`). `LEMONSQUEEZY_API_KEY_COMMAND` invokes an external command (vault CLI, 1Password, etc.) and caches the result for 1 hour. Lets credentials rotate without restarting the server.
- **Structured logger** (`src/logger.ts`). Opt-in via `LEMONSQUEEZY_LOG=json`. Emits JSON lines to stderr (stdout stays reserved for MCP protocol). Destructive tool calls are tagged `audit: true` with redacted inputs.
- **Request ID surfacing.** API error messages include upstream `X-Request-Id` when present, so support tickets can be traced.
- **Read-only integration tests.** `npm run test:integration` hits a live LemonSqueezy store if `LEMONSQUEEZY_TEST_API_KEY` + `LEMONSQUEEZY_TEST_STORE_ID` are set; skips gracefully otherwise. Exercises `ls_get_user`, `ls_get_store`, `ls_list_products`, `ls_list_variants`, `ls_list_orders`, `ls_list_subscriptions`, and 404 error paths. Runs nightly via `.github/workflows/integration.yml`.
- **`SEMVER.md`** -- documents what counts as a breaking change for this package (tool names, required inputs, return shapes), and what explicitly does not (upstream API drift, internal module names).

### Changed

- Input validation on every tool: `z.string()` fields capped at 10,000 chars, `.email()` fields capped at 320 chars. Protects against accidental DoS via oversized payloads.

### Fixed

- `parseRetryAfterMs` now correctly falls back to the default 1s when given a negative number like `"-3"` (previously `Date.parse("-3")` returned a finite value and produced a non-sensical delay).
- Retry policy no longer retries `5xx` on `POST`/`PATCH`/`PUT` -- prevents duplicate writes if a timeout is actually a slow success.

## [0.3.0] -- 2026-04-18

### Added

- Affiliate tools (`ls_list_affiliates`, `ls_get_affiliate`).
- `429` retry with exponential backoff in the API client.
- `SECURITY.md` -- vulnerability disclosure policy.
- `CONTRIBUTING.md` -- contributor and AI-agent guidelines.

## [0.2.1] -- 2026-04-16

### Changed

- Deduplicated tool handler boilerplate across tool files.

### Fixed

- API error handling surfaces upstream error bodies correctly.

### Added

- Error-path tests for every tool.

## [0.2.0] -- 2026-04-14

### Added

- Input validation via Zod `.describe()` on every tool input field.

### Fixed

- `ls_generate_order_invoice` and `ls_generate_subscription_invoice` now hit the correct endpoints and handle the async invoice-generation response shape.

## [0.1.1] -- 2026-04-12

### Added

- Edge-case handler tests for fuller coverage across all 59 tools.

## [0.1.0] -- 2026-04-11

Initial release. 59 tools covering all 17 LemonSqueezy API resources.

[Unreleased]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.9...HEAD
[0.11.1]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.13...v0.11.0
[0.10.13]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.12...v0.10.13
[0.10.12]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.11...v0.10.12
[0.10.11]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.10...v0.10.11
[0.10.10]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.9...v0.10.10
[0.10.9]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.8...v0.10.9
[0.10.8]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.7...v0.10.8
[0.10.7]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.6...v0.10.7
[0.10.6]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.5...v0.10.6
[0.10.5]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.4...v0.10.5
[0.10.4]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.3...v0.10.4
[0.10.3]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.2...v0.10.3
[0.10.2]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.9.3...v0.10.0
[0.9.3]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.7.1...v0.8.1
[0.7.1]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/YawLabs/lemonsqueezy-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/YawLabs/lemonsqueezy-mcp/releases/tag/v0.1.0
