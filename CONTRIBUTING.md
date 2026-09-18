# Contributing

Thanks for your interest in contributing! This guide covers the workflow for both human contributors and AI coding agents.

## Quick Start

```bash
# 1. Fork this repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/lemonsqueezy-mcp.git
cd lemonsqueezy-mcp

# 2. Install dependencies
npm install

# 3. Create a branch
git checkout -b your-branch-name

# 4. Make your changes, then verify everything passes
npm run lint:fix
npm run build
npm test
```

## Submitting a Pull Request

1. **One PR per change.** Keep PRs focused — a bug fix, a new feature, or a refactor, not all three.
2. **Branch from `main`.**
3. **Run `npm run lint:fix`** before committing — `npm run lint` (Biome) fails on formatting drift, and `release.sh` runs it before every release.
4. **Run `npm test`** and confirm all tests pass.
5. **Write a clear PR title and description** — explain *what* changed and *why*.
6. **A maintainer reviews and merges your PR.** Changes from contributors reach `main` only through a pull request.
7. **There is no CI.** Nothing re-runs lint, types or tests on your PR, so the commands above are the only gate. If you edit `Dockerfile`, also run `npm run gen:containerfile`: `release.sh` fails a release when `Containerfile` has drifted from it.
8. **Add a line under `## [Unreleased]` in `CHANGELOG.md`.** `release.sh` turns that section into the version's changelog entry and the GitHub release notes.
9. **Public-surface changes follow [SEMVER.md](./SEMVER.md).** Tool names, input fields, annotations, authority classes and each tool's class, which calls count as destructive, and documented env vars are all covered. `src/tools/tools.test.ts` pins the `destructiveHint: true`, `isDestructive`-predicate and `readOnlyHint: false` sets and the tool-to-class map, so changing one of those fails `npm test` until you update the test deliberately; update the README in the same PR. `idempotentHint` and `openWorldHint` are not pinned, so classify a change to either per SEMVER.md yourself.

## Development Workflow

| Command | What it does |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run build` | Type-check and compile to `dist/`, then bundle `dist/index.js` |
| `npm run dev` | Recompile TypeScript on change (`tsc --watch`) |
| `npm test` | Build, then run the unit and handler suite |
| `npm run test:integration` | Run the live integration suite against a real store. Needs `LEMONSQUEEZY_TEST_API_KEY` and `LEMONSQUEEZY_TEST_STORE_ID`, and exits 1 without them |
| `npm run lint` | Check for lint errors |
| `npm run lint:fix` | Auto-fix lint and formatting |

## Code Style

- TypeScript, strict mode
- Formatting and linting are enforced by the project's linter — run `lint:fix` and let the tooling handle it
- No unnecessary abstractions — keep code simple and direct
- Add tests for new functionality

## For AI Coding Agents

If you're an AI agent (Claude Code, Copilot, Cursor, etc.) submitting a PR:

1. **Fork the repo** and work on a branch — direct pushes to the default branch are blocked.
2. **Always run `npm run lint:fix && npm run build && npm test`** before committing. Do not skip this.
3. **Do not add unrelated changes** — no drive-by refactors, no extra comments, no unrelated formatting fixes.
4. **PR description must explain the change clearly** — what problem does it solve, how does it work, how was it tested.
5. **One logical change per PR.** If you're fixing a bug and adding a feature, that's two PRs.

## Reporting Issues

Open an issue on GitHub. Include:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Environment details (OS, Node version, etc.)

## License

By contributing, you agree that your contributions will be licensed under the same license as this project.
