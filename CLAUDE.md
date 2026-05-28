# lemonsqueezy-mcp

LemonSqueezy MCP server — manage your store, subscriptions, customers, and licenses from AI assistants.

## Architecture

- `src/index.ts` — Entry point. Registers all tools with McpServer, handles version subcommand.
- `src/api.ts` — LemonSqueezy API client. Bearer token auth, JSON:API format, 30s timeout. Also exports `licenseRequest` for the License API (different auth).
- `src/tools/*.ts` — Tool definitions as exported arrays. Each file covers one API resource domain.

## Build

- **Bundler:** esbuild (`build.mjs`) — single `dist/index.js` with zero runtime deps
- **Type checking:** tsc (separate pass before esbuild)
- **Linter:** Biome
- **Tests:** Node.js built-in test runner (`node --test`)
- **TypeScript:** Strict mode, ES2022 target, Node16 module resolution

## Key patterns

- Tools are arrays of `{ name, description, annotations, inputSchema, handler }` objects
- All tool names prefixed with `ls_`
- Zod schemas for input validation with `.describe()` for each field
- Every tool has MCP annotations: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`
- JSON:API query params built via `buildQuery({ include, filter, page })`
- Version injected at build time via esbuild `define`

## Release process

Two paths, both starting from a clean checkout of `main`:

1. **Tag-and-let-CI** (preferred): bump `package.json`, commit, tag `vX.Y.Z`, `git push origin main --follow-tags`. The push triggers `.github/workflows/release.yml`, which runs `release.sh` in CI mode. CI authenticates to npm via the org-level `NPM_TOKEN` secret and publishes with `--provenance`, then creates the GitHub release. No local `npm login` needed.

2. **Local end-to-end**: `./release.sh <version>` does steps 1-7 on the workstation -- lint, test, build, bump, commit, tag, push, npm publish, GitHub release, verify. Requires `npm login --auth-type=web` and `gh auth login` to be done once on the machine. Idempotent; safe to re-run after partial failures.

There is no push/PR CI and no nightly integration run. Lint, typecheck, and tests must pass locally before commit -- the release workflow is the only GitHub Actions job that fires.
