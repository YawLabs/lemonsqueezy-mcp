#!/usr/bin/env node
// Derive Containerfile from Dockerfile. The two files are byte-identical
// except for a single hint in the example invocation comment (docker run
// vs. podman run); regenerating from one source removes the drift surface
// that exists when both files are hand-edited.
//
// Modes:
//   node scripts/sync-containerfile.mjs          -- write Containerfile
//   node scripts/sync-containerfile.mjs --check  -- exit 1 if on-disk
//                                                   Containerfile would change
//
// Wired in via `npm run gen:containerfile` and `npm run check:containerfile`.
// CI calls --check so a divergent Dockerfile/Containerfile edit fails review.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dockerfilePath = join(repoRoot, "Dockerfile");
const containerfilePath = join(repoRoot, "Containerfile");

const source = readFileSync(dockerfilePath, "utf8");
// Global substitution on every "docker run -e" occurrence. Today there is
// exactly one in Dockerfile (the example-invocation comment), but using
// replaceAll keeps gen + check stable if a future edit adds a second
// reference -- a first-match-only replace would leave the second
// occurrence unswapped, and the check below would keep tripping even
// after `gen` ran. If a future Dockerfile edit mentions `docker`
// somewhere this transform doesn't reach (a flag name, an image tag),
// the check still surfaces the drift; extend the transform then.
const expected = source.replaceAll("docker run -e", "podman run -e");

if (process.argv.includes("--check")) {
  let actual;
  try {
    actual = readFileSync(containerfilePath, "utf8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`Containerfile read failed at ${containerfilePath}: ${detail}`);
    process.exit(1);
  }
  if (actual !== expected) {
    console.error("Containerfile is out of sync with Dockerfile.");
    console.error("Run `npm run gen:containerfile` to regenerate.");
    process.exit(1);
  }
  console.log("Containerfile in sync with Dockerfile.");
  process.exit(0);
}

writeFileSync(containerfilePath, expected);
console.log(`Wrote ${containerfilePath} (derived from Dockerfile).`);
