# Versioning policy

`@yawlabs/lemonsqueezy-mcp` follows [semantic versioning](https://semver.org). This document defines what each change type means for this package specifically, so callers (especially unattended agents pinned to a version range) know what to expect.

## What is a breaking (MAJOR) change

Any of the following ship as a MAJOR bump:

- **Removing or renaming a tool** (`ls_*`).
- **Removing or renaming a required input field** on any tool.
- **Changing the type or validation of an input field** in a way that rejects previously-valid inputs (for example, narrowing a `string` to an enum).
- **Changing the shape of a tool's success response** beyond what LemonSqueezy returns (we return upstream payloads as-is, so upstream schema changes are not controlled by our semver).
- **Removing or renaming an environment variable** that users configure (e.g. `LEMONSQUEEZY_API_KEY`, guardrail vars, `LEMONSQUEEZY_LOG`).
- **Raising the minimum Node.js version.**
- **Changing the MCP annotation class of a tool** in a way that changes client trust decisions (e.g. flipping `readOnlyHint` from `true` to `false`, or `destructiveHint` from `false` to `true`).

## What is a MINOR change

- **Adding a new tool.**
- **Adding a new optional input field** to an existing tool.
- **Adding a new optional environment variable.**
- **Relaxing input validation** (e.g. raising a `max` length).
- **Adding retry, logging, or guardrail behavior** that is opt-in or does not change success/failure outcomes for previously-working calls.
- **Expanding an existing enum** with new accepted values.

## What is a PATCH change

- Bug fixes that make behavior match documentation.
- Upstream schema pass-through fixes (unwrapping an error message more clearly, for example).
- Performance improvements.
- Doc / dependency updates with no runtime behavior change.

## Specifically not covered by semver

- **Upstream LemonSqueezy API changes.** This package is a thin wrapper over `api.lemonsqueezy.com/v1`. If LemonSqueezy renames a field in a response, our tool result shape changes even though our version does not. Run the nightly integration workflow (`.github/workflows/integration.yml`) to catch drift.
- **Log line schema.** The structured log format (`LEMONSQUEEZY_LOG=json`) is best-effort stable but not part of the semver contract — downstream log parsers should tolerate added fields.
- **Internal modules** (`src/retry.ts`, `src/secret.ts`, `src/logger.ts`, `src/guardrails.ts`, `src/api.ts`). Only the MCP tool surface and documented env vars are covered.

## Pre-1.0

While on `0.x`:

- Minor bumps (`0.x → 0.(x+1)`) may include breaking changes if clearly called out in the release notes. We try to avoid them, but reserve the right.
- Patch bumps (`0.x.y → 0.x.(y+1)`) do not break.

Once `1.0.0` ships the rules above apply strictly.
