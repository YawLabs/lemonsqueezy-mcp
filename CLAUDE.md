# lemonsqueezy-mcp

LemonSqueezy MCP server — manage your store, subscriptions, customers, and licenses from AI assistants.

## Architecture

- `src/index.ts` — Entry point. Registers all tools with McpServer, handles version subcommand. Must stay free of top-level await (the single-binary build emits CJS).
- `src/api.ts` — LemonSqueezy API client. Bearer token auth, JSON:API format, 30s timeout. Also exports `licenseRequest` for the License API (different auth), plus the shared `buildQuery` / `buildInvoiceQuery` / cross-store-note helpers used by the tool modules.
- `src/wrapper.ts` — Sits between the SDK's registered handler and each tool handler. Runs the guardrails in a load-bearing order, then logs and audits. `createToolHandler` is the only production caller path.
- `src/guardrails.ts` — Store allowlist, refund cap, destructive + per-authority-class rate limits. All opt-in via env.
- `src/tools/*.ts` — Tool definitions as exported arrays. Each file covers one API resource domain.

## Build

- **Bundler:** esbuild (`build.mjs`) — single `dist/index.js` with zero runtime deps
- **Type checking:** tsc (separate pass before esbuild)
- **Linter:** Biome
- **Tests:** Node.js built-in test runner (`node --test`)
- **TypeScript:** Strict mode, ES2022 target, Node16 module resolution

## Key patterns

- Tools are arrays of `{ name, description, authorityClass, annotations, inputSchema, handler }` objects
- All tool names prefixed with `ls_`
- Zod schemas for input validation with `.describe()` for each field
- Every tool has MCP annotations: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`
- JSON:API query params built via `buildQuery({ include, filter, page })`
- Version injected at build time via esbuild `define`
- Optional per-tool hooks on the wrapper: `isDestructive(input)` (per-call destructive verdict), `requiredFilters` (store-allowlist scoping for list-by-parent tools), and `preflight(input)` (input guardrail that must reject *before* the rate limiters — the refund cap uses it)
- A list tool with neither a `storeId` field nor `requiredFilters` is completely ungated by the store allowlist. `tools.test.ts` fails on any new one; the two known cases must disclose it via `crossStoreUngatedNote()`
- Update tools reject an ID-only PATCH locally rather than paying a round-trip for an upstream 422, throwing `ToolInputError` so the wrapper logs it as `validation_error` (client mistake) rather than `exception` (something faulted) or `guardrail_block` (operator policy)
- `redact.ts` guards cycles with an ancestor path *plus* a memo of completed subtrees — the ancestor set alone is O(paths), which is exponential on a shared-reference DAG

## Runtime

Node is the default and the only runtime the published package assumes. [oam.js](https://oamjs.org) runs the server unmodified (re-verified against 0.9.0 — full handshake, all 64 tools, resource, fetch, identical guardrail errors) but is **opt-in**, because oam is not on npm and defaulting to it would break `npx` for anyone without it.

**Minimum oam is 0.9.0**, enforced in `bin/lemonsqueezy-mcp.mjs`. Older releases ran `execFile` arguments through a shell, which is reachable here via `LEMONSQUEEZY_API_KEY_COMMAND`. An older oam falls back to Node with a note on stderr; `LEMONSQUEEZY_MCP_RUNTIME=oam` makes it a hard error. `LEMONSQUEEZY_MCP_SANDBOX=1` opts into `--permission` (net limited to the API host, fs denied, child denied unless the key-command feature is configured).

The cold-start figures previously quoted here (196ms Node vs 424ms `oam run`) are **withdrawn, not restated**: they were taken with the methodology that npmjs-mcp later documented as wrong — timing a binary out of a cargo `target/` directory while it was being rebuilt. Interleaved runs against an *installed* oam put it ahead of Node on the sibling servers. Nothing has been re-measured for this repo, so treat runtime choice here as untimed rather than as a decided cost.

**Keep `src/` runtime-agnostic.** No `oam:`-prefixed imports, tests stay on `node:test`. The moment an oam-only API lands in source, "falls back to Node" stops being true. oam is used at BUILD time only: `npm run check:oam` (tsgo typecheck, faster than `tsc`) and `npm run build:binary:oam` (`oam compile` instead of Node SEA, ~57 MB). Both write nothing into the npm package.

## Release process

Releases run **locally** from a clean checkout of `main` via `./release.sh <version>`, which does steps 1-7 on the workstation -- lint, test, build, bump, commit, tag, push, npm publish (with `--provenance`), GitHub release, verify. Requires `npm login --auth-type=web` and `gh auth login` to be done once on the machine. Idempotent; safe to re-run after partial failures.

There is **no GitHub Actions release workflow** in this repo: `.github/` holds only `CODEOWNERS`. CI-on-tag-push (the YawLabs default -- a tag-triggered release workflow runs `release.sh` in CI mode, authenticating to npm via the org-level `NPM_TOKEN` secret) is the intended end state but is not wired up here today; until it is, `release.sh` is the only path.

There is also no push- or PR-triggered CI, no Dependabot, and no nightly integration run — every workflow and the Dependabot config were removed (`823d558`). Lint, typecheck, and tests must pass locally before commit. `npm run test:integration` is on demand only; it needs `LEMONSQUEEZY_TEST_API_KEY` + `LEMONSQUEEZY_TEST_STORE_ID` and writes throwaway `ci-test-` resources to a real store.

**Run `npm run test:integration` before cutting a release whenever `src/api.ts` or a tool handler changed.** The unit suite mocks `globalThis.fetch`, so it cannot see upstream schema drift — and `api.ts` sits under every single tool call, meaning a regression there is invisible locally and total in production. Add a `## [X.Y.Z]` section to `CHANGELOG.md` too: `release.sh` extracts it for the GitHub release body and silently falls back to bare commit subjects when it's missing.
