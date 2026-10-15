#!/usr/bin/env node
// Build a self-contained single-file binary of the @yawlabs/lemonsqueezy-mcp
// server with `oam compile`.
//
// Strategy: esbuild bundles src/index.ts + ALL its dependencies (including
// the externals the npm build leaves out -- @modelcontextprotocol/sdk and
// undici) into ONE CommonJS file with zero remaining node_modules resolution,
// then `oam compile` embeds that bundle into oam's runtime carrier. The result
// runs with no Node, no node_modules, and no PATH dependency. Measured at
// ~57 MB on win32-arm64.
//
// CRITICAL: the bundle handed to `oam compile` MUST be CJS. `oam compile` runs
// the embedded file as CommonJS, and the ESM bundle build.mjs writes to
// dist/index.js dies at startup with `SyntaxError: Cannot use import statement
// outside a module`. So this script re-bundles as CJS rather than reusing
// dist/index.js.
//
// This is a BUILD-time use of oam only. Nothing about it reaches the published
// npm package or the runtime code, which stays runtime-agnostic on purpose so
// the Node path remains a real fallback rather than a nominal one.
//
// If you redistribute this binary it embeds oam's runtime: ship oam's LICENSE,
// NOTICE and THIRD_PARTY_LICENSES.md alongside it.
//
// This script ONLY reads node_modules (via esbuild's resolver) and writes to
// build-tmp/ and bin/<platform>-<arch>/. It does NOT mutate package.json,
// package-lock.json, src/, or node_modules, and it never runs `npm install`.
// scripts/stage-release-asset.mjs consumes the bin/<platform>-<arch>/ output.

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const isWin = process.platform === 'win32';

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
const { version } = pkg;
// Binary name = the package's first `bin` command, so this script is
// copy-paste generic across @yawlabs/* servers -- no per-repo rename.
const binName = Object.keys(pkg.bin ?? {})[0] ?? pkg.name.split('/').pop();
// Bundle the SOURCE behind the bin's dist entry (src/index.ts, src/server.ts,
// src/runner.ts, ...) so this works regardless of the server's entry filename.
// Pinned, NOT derived from `bin`. Mapping bin's VALUE to a source path
// (dist/index.js -> src/index.ts) breaks the moment `bin` is repointed at the
// runtime launcher: it yields bin/lemonsqueezy-mcp.ts, which does not exist.
// postgres-mcp shipped exactly that breakage in its 0.9.0. This script is a
// manual per-host step that neither `npm test` nor the release flow runs, so a
// wrong guess stays invisible until someone builds a binary.
const srcEntry = 'src/index.ts';
if (!existsSync(join(repoRoot, srcEntry))) {
  console.error(`build-binary-oam: source entry '${srcEntry}' does not exist -- update this constant`);
  process.exit(1);
}

const platformDir = `${process.platform}-${process.arch}`;
const binDir = join(repoRoot, 'bin', platformDir);
const tmpDir = join(repoRoot, 'build-tmp');
const bundlePath = join(tmpDir, 'oam-bundle.cjs');
const exeName = isWin ? `${binName}.exe` : binName;
const outExe = join(binDir, exeName);

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { stdio: 'inherit', cwd: repoRoot, ...opts });
}

function fmtSize(p) {
  const bytes = statSync(p).size;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB (${bytes} bytes)`;
}

mkdirSync(tmpDir, { recursive: true });
mkdirSync(binDir, { recursive: true });

// 1. Bundle everything into one CJS file (externals included) via esbuild's
// JS API. NOT the CLI bin: on Linux/macOS esbuild swaps node_modules/esbuild/
// bin/esbuild for the NATIVE binary (only Windows keeps it a JS shim), so
// `node bin/esbuild` would feed a binary to the JS parser and die. The API
// also takes the __VERSION__ define as data -- no shell-quoting games.
await esbuild.build({
  entryPoints: [join(repoRoot, srcEntry)],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // esbuild leaves import.meta.url EMPTY in cjs output, so a server that reads
  // it (e.g. createRequire(import.meta.url) to find package.json) crashes at
  // load with createRequire(undefined). Polyfill it to the carrier's own path
  // (__filename is the executable inside the compiled binary). Version reads
  // should still prefer the __VERSION__ define; this is the safety net for
  // everything else.
  banner: { js: "const __bundleImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  define: { __VERSION__: JSON.stringify(version), 'import.meta.url': '__bundleImportMetaUrl' },
  // Optional native addons some servers pull transitively (ssh2 -> cpu-features)
  // are require()'d inside try/catch; mark them external so esbuild doesn't
  // choke on the .node binary -- they degrade gracefully when absent.
  external: ['cpu-features'],
  outfile: bundlePath,
});
console.log(`bundle: ${fmtSize(bundlePath)}`);

// 2. Embed the bundle into oam's runtime carrier. `oam compile` writes the
// finished executable directly -- no blob generation or injection step.
rmSync(outExe, { force: true });
run('oam', ['compile', bundlePath, '--output', outExe]);
if (!isWin) chmodSync(outExe, 0o755);

// 3. macOS: ad-hoc re-sign. Apple Silicon SIGKILLs a Mach-O with no/invalid
// signature at exec, and `--sign -` is the free ad-hoc identity (no cert, no
// notarization). Distribution is via the Homebrew TAP (a formula), whose curl
// fetch sets no com.apple.quarantine, so Gatekeeper never blocks it -- ad-hoc
// is sufficient. Best-effort: if oam already emits a signed binary this is a
// harmless no-op.
if (process.platform === 'darwin') {
  try {
    run('codesign', ['--sign', '-', '--force', '--timestamp=none', outExe]);
    run('codesign', ['--verify', '--verbose', outExe]);
  } catch {
    console.log('(codesign step failed -- continuing; verify the binary launches before shipping)');
  }
}

// 4. Smoke: a signature check proves a signature, not that the thing runs.
// Actually launch it, on every platform.
run(outExe, ['--version']);

console.log('');
console.log(`OK  ${outExe}`);
console.log(`    ${fmtSize(outExe)} (oam compile)`);
console.log('');
console.log("NOTE: this binary embeds oam's runtime (V8, ICU and others). If you");
console.log("      redistribute it, ship oam's LICENSE, NOTICE and THIRD_PARTY_LICENSES.md");
console.log('      alongside it.');
console.log('');
console.log('Verify with:');
console.log(`    "${outExe}" --version`);
console.log(`    "${outExe}" doctor --json`);
