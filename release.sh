#!/bin/bash
# =============================================================================
# Release script -- local + CI dual mode: lint, test, build, tag, publish, release
# =============================================================================
# Usage:
#   ./release.sh <version>      e.g. ./release.sh 0.7.0    -- local end-to-end
#   ./release.sh                -- CI mode (derives version from $GITHUB_REF_NAME)
#
# If interrupted, re-run with the same version. Each step is idempotent:
# already-bumped, already-tagged, already-published, and already-released
# states are detected and skipped.
#
# Prerequisites for LOCAL runs (one-time setup on this machine):
#   - Node.js 22+
#   - npm authenticated as a publisher of @yawlabs/lemonsqueezy-mcp via an
#     AUTOMATION token in ~/.npmrc (npmjs.com -> Access Tokens -> Generate
#     -> Automation):
#       @yawlabs:registry=https://registry.npmjs.org/
#       //registry.npmjs.org/:_authToken=npm_YOURTOKEN
#     Do NOT run 'npm login --auth-type=web' -- it OVERWRITES that automation
#     token with a 2FA-bound web session, and the next publish then EOTPs on
#     a WebAuthn challenge (any CI sharing the token starts failing too).
#   - GitHub CLI authenticated
#       gh auth login
#
# Prerequisites for CI runs:
#   - $CI=true
#   - $GITHUB_REF_NAME=vX.Y.Z (set automatically by the tag-push trigger)
#   - $NODE_AUTH_TOKEN populated from secrets.NPM_TOKEN (org-level)
#   - $GITHUB_TOKEN populated automatically by Actions
#
# This repo has no release workflow (.github/ holds only CODEOWNERS), so the
# local run is the only release path: it does every step on the workstation,
# including the npm publish (step 5) and the MCP Registry publish (step 7).
# CI mode is kept for a tag-push release workflow, the intended end state;
# nothing invokes it today.
# =============================================================================

set -euo pipefail
trap 'echo -e "\n\033[0;31m  x Release failed at line $LINENO (exit code $?)\033[0m"' ERR

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

TOTAL_STEPS=8
step() { echo -e "\n${CYAN}=== [$1/$TOTAL_STEPS] $2 ===${NC}"; }
info() { echo -e "${GREEN}  + $1${NC}"; }
warn() { echo -e "${YELLOW}  ! $1${NC}"; }
fail() { echo -e "${RED}  x $1${NC}"; exit 1; }

# --- CHANGELOG promotion (ported from ctxlint) ---------------------------
# These scripts never promoted the [Unreleased] heading, so documented work
# accumulated there and shipped versions went out undocumented -- the cause of
# seven backfilled entries across this fleet on 2026-08-23. The promotion then
# skipped any release with nothing under [Unreleased], and step 6 took the
# GitHub release notes from commit subjects whenever the version had no
# section, so ten versions shipped across the fleet on 2026-09-13 with no
# changelog entry and subject-list release notes (0.14.0 here).
#
# Every release now gets a `## [<version>]` entry, and step 6 sources the
# release notes from it:
#   * [Unreleased] has content -> it becomes the version section, and a fresh,
#     empty [Unreleased] heading is left above it for the next change.
#   * [Unreleased] is empty or absent -> a version section is generated from
#     the commit subjects since the previous tag. Raw subjects are less than a
#     hand-written entry, but a version with no entry at all reads as a mistake.
#   * The Keep-a-Changelog link references at the bottom, when the file has
#     them, are moved along: [Unreleased] compares from the new tag, and the
#     version gets its own compare link.

changelog_section() {
  [ -f CHANGELOG.md ] || return 0
  awk -v heading="$1" '
    index($0, "## [" heading "]") == 1 { capture=1; next }
    capture && /^## \[/ { exit }
    capture { print }
  ' CHANGELOG.md
}

# True when a section body carries any non-whitespace content.
changelog_nonempty() { [ -n "$(echo "$1" | tr -d '[:space:]')" ]; }

# Reuse whatever separator this file already puts between version and date.
# The fleet mixes an em-dash and "--"; promoting with a hardcoded one would
# introduce a third style into whichever repos do not use it.
changelog_dash() {
  local d
  d=$(sed -nE 's/^## \[[0-9][^]]*\][[:space:]]+([^[:space:]]+)[[:space:]]+[0-9]{4}-[0-9]{2}-[0-9]{2}.*/\1/p' CHANGELOG.md 2>/dev/null | head -1)
  if [ -n "$d" ]; then printf '%s' "$d"; else printf '%s' '--'; fi
}

# The tag this release is compared against: the newest v* tag reachable from
# HEAD other than this release's own (a re-run after tagging must not compare
# the version with itself). Empty on a first release.
changelog_prev_tag() {
  git describe --tags --abbrev=0 --match 'v*' --exclude "v${VERSION}" 2>/dev/null || true
}

# The body of a generated entry: one bullet per commit subject since the
# previous tag, newest first, with version-bump commits dropped.
changelog_generated_body() {
  local prev=$1 range subjects
  if [ -n "$prev" ]; then range="${prev}..HEAD"; else range="HEAD"; fi
  subjects=$(git log --no-merges --format='%s' "$range" 2>/dev/null \
    | grep -vE '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed 's/^/- /' || true)
  [ -n "$subjects" ] || subjects="- Maintenance release; no changes since ${prev:-the previous release}."
  printf '### Changed\n%s\n' "$subjects"
}

# Keep-a-Changelog link references, when the file uses them: [Unreleased]
# compares from the new tag, and the version gets its own compare link (or a
# tag link on a first release). A version link that already exists is kept.
changelog_update_links() {
  local prev=$1 tmp
  grep -qE '^\[Unreleased\]: .*/compare/.*\.\.\.HEAD' CHANGELOG.md || return 0
  tmp=$(mktemp)
  awk -v ver="$VERSION" -v prev="$prev" -v have_link="$(grep -c "^\[${VERSION}\]: " CHANGELOG.md || true)" '
    !done && /^\[Unreleased\]: .*\/compare\/.*\.\.\.HEAD/ {
      url=$0; sub(/^\[Unreleased\]: /, "", url); sub(/\/compare\/.*$/, "", url)
      print "[Unreleased]: " url "/compare/v" ver "...HEAD"
      if (have_link == 0) {
        if (prev != "") print "[" ver "]: " url "/compare/" prev "...v" ver
        else print "[" ver "]: " url "/releases/tag/v" ver
      }
      done=1; next
    }
    { print }
  ' CHANGELOG.md > "$tmp" || { rm -f "$tmp"; fail "CHANGELOG.md link update failed"; }
  mv "$tmp" CHANGELOG.md
}

# Make sure `## [<version>] <dash> <today>` exists: promote [Unreleased] when it
# has content, otherwise generate the section from the commit subjects.
promote_changelog() {
  [ -f CHANGELOG.md ] || return 0
  local prev
  prev=$(changelog_prev_tag)
  if changelog_nonempty "$(changelog_section "$VERSION")"; then
    info "CHANGELOG.md already has an entry for v${VERSION}"
    changelog_update_links "$prev"
    return 0
  fi
  local today tmp dash heading body
  today=$(date +%F)
  dash=$(changelog_dash)
  heading="## [${VERSION}] ${dash} ${today}"
  tmp=$(mktemp)
  if changelog_nonempty "$(changelog_section "Unreleased")"; then
    # Rewrite only the FIRST [Unreleased] heading: a stray later mention (a link
    # reference, a quoted example) must not become a second, bogus heading.
    awk -v repl="$heading" '
      !promoted && index($0, "## [Unreleased]") == 1 { print "## [Unreleased]"; print ""; print repl; promoted=1; next }
      { print }
    ' CHANGELOG.md > "$tmp" || { rm -f "$tmp"; fail "CHANGELOG.md promotion failed"; }
    info "CHANGELOG.md: promoted [Unreleased] -> [${VERSION}] ${dash} ${today}"
  else
    body=$(changelog_generated_body "$prev")
    warn "CHANGELOG.md has no [Unreleased] content -- writing [${VERSION}] from the commit subjects since ${prev:-the first commit}; edit it if they undersell the release"
    # Insert below an empty [Unreleased] heading, else above the first version
    # heading, else at the end of the file.
    awk -v heading="$heading" -v body="$body" '
      !done && index($0, "## [Unreleased]") == 1 { print; print ""; print heading; print ""; print body; done=1; next }
      !done && /^## \[/ { print heading; print ""; print body; print ""; done=1 }
      { print }
      END { if (!done) { print ""; print heading; print ""; print body } }
    ' CHANGELOG.md > "$tmp" || { rm -f "$tmp"; fail "CHANGELOG.md entry generation failed"; }
    info "CHANGELOG.md: added [${VERSION}] ${dash} ${today} from commit subjects"
  fi
  mv "$tmp" CHANGELOG.md
  changelog_update_links "$prev"
}

# Backstop for the promotion above: every release has an entry now, so a
# missing one means promote_changelog did not run or did not land, and the
# release notes in step 6 would silently fall back to commit subjects.
assert_changelog_promoted() {
  [ -f CHANGELOG.md ] || return 0
  changelog_nonempty "$(changelog_section "$VERSION")" && return 0
  fail "CHANGELOG.md has no '## [${VERSION}]' entry -- promote_changelog did not run or did not land."
}

# Release notes for step 6: the version's changelog section, trimmed of the
# blank lines around it; commit subjects only when there is no changelog.
release_notes() {
  local notes
  notes=$(changelog_section "$VERSION" | sed -e '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')
  if changelog_nonempty "$notes"; then
    printf '%s\n' "$notes"
  elif [ -n "${1:-}" ] && [ "$1" != "v${VERSION}" ]; then
    git log --oneline "${1}..v${VERSION}" --no-decorate | sed 's/^[a-f0-9]* /- /'
  else
    printf 'Initial release\n'
  fi
}

# SKIP_LINT=1 escape hatch -- wraps `npm`/`pnpm` so lint-related runs are
# no-ops.
#
# THIS SHOULD NOW BE UNNECESSARY, and reaching for it is a signal something
# regressed. `npm run lint` routes through scripts/lint.mjs, which picks a
# biome binary that works on the host -- including Windows ARM64, where the
# arm64 build of SOME biome versions crashes on a real check (2.5.4, the
# version this repo installs, measured at exit 139 there; 2.4.16 and 2.5.13
# run fine), and the wrapper runs the x64 build of that same version under
# emulation instead. Verified: `npm run lint` exits 0 on that host.
#
# The earlier text here blamed "the MINGW64-ARM64 npm-run-script wrapper" and
# justified skipping with "CI catches lint regressions anyway". Both were wrong.
# `npm run` is fine on that host (`npm run lint` through scripts/lint.mjs is a
# plain node script through the same wrapper, and exits 0); the crash comes
# from the arm64 `biome.exe` of the affected version itself, reproducible by
# invoking that binary directly with no npm in the picture. And this repo has
# no CI: there is no .github/workflows directory, so nothing downstream
# re-checks formatting -- skipping the lint step means the release is
# published unlinted, full stop.
#
# So: only set SKIP_LINT=1 if scripts/lint.mjs cannot produce a result at all,
# and treat that as a bug to fix rather than a step to routinely skip. Without
# it, step 1 fails the release on ANY non-zero lint exit, a crash included.
if [ "${SKIP_LINT:-}" = "1" ]; then
  npm() {
    if [ "$1" = "run" ] && [[ "$2" == lint* ]]; then
      warn "SKIP_LINT=1 -- noop 'npm run $2'"
      return 0
    fi
    command npm "$@"
  }
  pnpm() {
    if [ "$1" = "run" ] && [[ "$2" == lint* ]]; then
      warn "SKIP_LINT=1 -- noop 'pnpm run $2'"
      return 0
    fi
    command pnpm "$@"
  }
fi

# ---- Resolve version + mode ----
VERSION="${1:-}"
IS_CI="${CI:-false}"

if [ -z "$VERSION" ]; then
  if [ "$IS_CI" = "true" ] && [ -n "${GITHUB_REF_NAME:-}" ]; then
    VERSION="${GITHUB_REF_NAME#v}"
    info "CI mode -- version $VERSION from tag $GITHUB_REF_NAME"
  else
    echo "Usage: ./release.sh <version>"
    echo "  e.g. ./release.sh 0.7.0"
    exit 1
  fi
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fail "Invalid version format: $VERSION (expected X.Y.Z)"
fi

# ---- Pre-flight ----
echo -e "${CYAN}Pre-flight checks...${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

command -v node >/dev/null || fail "node not installed"
command -v npm  >/dev/null || fail "npm not installed"

if [ "$IS_CI" != "true" ]; then
  command -v gh >/dev/null || fail "gh not installed (https://cli.github.com)"
  gh auth status >/dev/null 2>&1 || fail "gh is not authenticated. Run: gh auth login"

  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [ "$CURRENT_BRANCH" != "main" ]; then
    fail "Must release from 'main' branch (currently on '$CURRENT_BRANCH')"
  fi

  # npm auth gate. Step 5 publishes from this workstation unless the version
  # is already on npm or a release.yml with a publish path takes over -- and
  # none exists (see the header), so today the workstation always publishes.
  # Without this gate a dead token surfaces only at step 5, AFTER step 4 has
  # pushed the vX.Y.Z tag: a public tag with no npm package behind it. The
  # condition mirrors step 5's branch selection exactly, so the gate runs
  # only when step 5 would take the workstation-publish branch. In particular
  # it is skipped on a resume where the version is already on npm, because
  # steps 6-8 never use the token. The old unconditional check was dropped in
  # 69fc4bd for exactly that reason -- it blocked releases on a credential the
  # run never used, back when CI did the publishing.
  #
  # `npm whoami` proves the token is LIVE, not that it is an automation token
  # or that it may publish this package. A 2FA-bound web session left by
  # 'npm login --auth-type=web' passes it too, and its EOTP only shows up at
  # step 5. What this catches is the dead or missing token, which step 5
  # would otherwise hit as a failed publish after the tag is already public.
  if ! { [ -f ".github/workflows/release.yml" ] && grep -q "npm publish\|NODE_AUTH_TOKEN" .github/workflows/release.yml; } \
    && [ "$(npm view "@yawlabs/lemonsqueezy-mcp@${VERSION}" version 2>/dev/null || echo "")" != "$VERSION" ]; then
    npm whoami >/dev/null 2>&1 || fail "npm whoami failed -- the automation token in ~/.npmrc is dead or missing (or the registry is unreachable). Stopping before step 5 publishes (on a fresh run, also before step 4 pushes the v${VERSION} tag). Restore the token per the header (never 'npm login --auth-type=web'), then re-run."
  fi
fi

CURRENT_VERSION=$(node -p "require('./package.json').version")
RESUMING=false

if [ "$CURRENT_VERSION" = "$VERSION" ]; then
  RESUMING=true
  info "package.json already at v${VERSION} -- resuming a previous run"
else
  if [ "$IS_CI" != "true" ] && [ -n "$(git status --porcelain)" ]; then
    fail "Working directory not clean. Commit or stash changes first."
  fi
  info "Current: v${CURRENT_VERSION} -> v${VERSION}"
fi

if [ "$IS_CI" != "true" ] && [ "$RESUMING" != "true" ]; then
  echo ""
  echo -e "${YELLOW}About to release v${VERSION}. This will:${NC}"
  echo "  1. Lint + Containerfile drift check"
  echo "  2. Test"
  echo "  3. Bump version in package.json"
  echo "  4. Commit, tag, and push to origin/main"
  echo "  5. Publish to npm"
  echo "  6. Create GitHub release"
  echo "  7. Publish to MCP Registry"
  echo "  8. Verify"
  echo ""
  if [ -t 0 ]; then
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 0
    fi
  else
    info "Non-interactive shell -- proceeding without confirmation"
  fi
fi

# =============================================================================
# Step 1: Lint
# =============================================================================
step 1 "Lint and Containerfile drift check"
npm run lint || fail "Lint failed (try: npm run lint:fix)"
info "Lint passed"
npm run check:containerfile || fail "Containerfile drifted from Dockerfile (run: npm run gen:containerfile)"
info "Containerfile in sync with Dockerfile"

# =============================================================================
# Step 2: Test (npm test runs the build internally)
# =============================================================================
step 2 "Test"
npm test || fail "Tests failed"
info "Tests passed"

# =============================================================================
# Step 3: Bump version
# =============================================================================
step 3 "Bump version to $VERSION"
if [ "$CURRENT_VERSION" = "$VERSION" ]; then
  info "Already at v${VERSION} -- skipping"
elif [ "$IS_CI" = "true" ]; then
  # In CI the tag is what triggered this run; package.json on the tagged
  # commit must already match. If it doesn't, someone tagged without first
  # committing the version bump -- bumping here would publish the right
  # version but leave main pointing at the old one. Fail loudly instead.
  fail "package.json is at v${CURRENT_VERSION} but tag is v${VERSION}. Tag without prior version bump on main -- refusing to publish a version that disagrees with the source."
else
  npm version "$VERSION" --no-git-tag-version
  info "package.json bumped"
fi

# server.json is published to the MCP Registry in step 7 and must match the
# tag's version. This runs UNCONDITIONALLY (not inside the bump else above)
# so a resume run where package.json was bumped in a prior invocation still
# syncs server.json -- otherwise mcp-publisher tries to re-publish the
# previous version and gets 400 "cannot publish duplicate version".
# Idempotent: the inner if skips the write when server.json is already in
# sync, so a clean re-run produces no working-tree dirt.
if [ -f server.json ]; then
  CURRENT_SERVER_VERSION=$(jq -r '.version' server.json 2>/dev/null || echo "")
  if [ "$CURRENT_SERVER_VERSION" != "$VERSION" ]; then
    jq --arg v "$VERSION" '.version = $v | .packages[0].version = $v' server.json > server.tmp
    mv server.tmp server.json
    info "server.json synced to $VERSION"
  fi
fi

# =============================================================================
# Step 4: Commit, tag, and push (skipped in CI -- the tag is what triggered us)
# =============================================================================
# Promote the heading BEFORE the bump commit, so the rewrite is committed
# with the version bump rather than left dirty in the working tree.
promote_changelog
assert_changelog_promoted

step 4 "Commit, tag, and push"
if [ "$IS_CI" = "true" ]; then
  info "CI mode -- skipping commit/tag/push (tag $GITHUB_REF_NAME already triggered this run)"
else
  if [ -n "$(git status --porcelain package.json package-lock.json server.json 2>/dev/null)" ]; then
    git add package.json package-lock.json server.json CHANGELOG.md
    git commit -m "v${VERSION}"
    info "Committed version bump"
  else
    info "Nothing to commit (already committed)"
  fi

  if git tag -l "v${VERSION}" | grep -q "v${VERSION}"; then
    info "Tag v${VERSION} already exists locally"
  else
    # Annotated (-a) so `git push --follow-tags` below picks it up;
    # lightweight tags are ignored by --follow-tags and would silently
    # fail to publish (release commit lands but tag-push is a no-op).
    git tag -a "v${VERSION}" -m "v${VERSION}"
    info "Tag v${VERSION} created"
  fi

  # Tag-drift safety: refuse to push if origin already has a tag at this name
  # pointing to a different commit (rewound tag elsewhere, parallel release race).
  # Without this check, `git push --follow-tags` SILENTLY skips updating the
  # tag on origin (the tag exists, no fast-forward happens). The main push
  # reports success, but origin's tag stays at the old SHA -- and the later
  # `gh release create` step then creates a GitHub release linked to that
  # stale commit while npm carries the new one.
  ORIGIN_TAG_SHA=$(git ls-remote --tags origin "refs/tags/v${VERSION}" 2>/dev/null | awk '{print $1}')
  if [ -n "$ORIGIN_TAG_SHA" ]; then
    LOCAL_TAG_SHA=$(git rev-parse "v${VERSION}")
    if [ "$ORIGIN_TAG_SHA" != "$LOCAL_TAG_SHA" ]; then
      fail "Tag v${VERSION} exists on origin at $ORIGIN_TAG_SHA but local tag points to $LOCAL_TAG_SHA -- resolve the drift before re-running"
    fi
  fi

  git push origin main --follow-tags
  info "Pushed main + tags to origin"
fi

# =============================================================================
# Step 5: Publish to npm
# =============================================================================
step 5 "Publish to npm"
# Three publish paths, picked by environment:
#   1. IS_CI=true                    -> WE are CI. Do the publish (NODE_AUTH_TOKEN
#                                       is set; --provenance for sigstore).
#   2. IS_CI=false + release.yml     -> CI will publish on the tag we just pushed.
#      exists with CI publish path      Watch `gh run watch` for that run and
#                                       verify via `npm view`. Workstation MUST
#                                       NOT also publish -- stale ~/.npmrc fails
#                                       E404, valid one races CI for the same
#                                       version. CI is authoritative.
#   3. IS_CI=false + no CI publish   -> Workstation IS the publisher. Try locally
#      path                             with EOTP retry for fresh WebAuthn sessions.
PUBLISHED_VERSION=$(npm view "@yawlabs/lemonsqueezy-mcp@${VERSION}" version 2>/dev/null || echo "")
if [ "$PUBLISHED_VERSION" = "$VERSION" ]; then
  info "v${VERSION} already published on npm -- skipping"
  # Resume-path safety: a prior interrupted run may have published but never
  # observed `gh run watch` to completion. Later CI steps (smoke test, MCP
  # Registry publish, attestation upload) could have failed silently. Look
  # up the most recent Release run for this tag and warn if its conclusion
  # was non-success. Best-effort -- if the tag isn't on origin yet or the
  # run isn't visible, the warn just doesn't fire.
  if [ "$IS_CI" != "true" ] && [ -f ".github/workflows/release.yml" ]; then
    RESUME_TAG_SHA=$(git rev-parse "v${VERSION}^{}" 2>/dev/null || echo "")
    if [ -n "$RESUME_TAG_SHA" ]; then
      RESUME_CONCLUSION=$(gh run list --workflow=Release --event=push --commit="$RESUME_TAG_SHA" --limit=1 --json conclusion --jq '.[0].conclusion' 2>/dev/null || echo "")
      if [ -n "$RESUME_CONCLUSION" ] && [ "$RESUME_CONCLUSION" != "success" ]; then
        warn "Prior CI Release run for v${VERSION} ended with conclusion='$RESUME_CONCLUSION' (not 'success'). A post-publish step (smoke test, MCP Registry publish, attestation) may have failed silently. Inspect: gh run list --workflow=Release --commit=$RESUME_TAG_SHA --limit=3"
      fi
    fi
  fi
elif [ "$IS_CI" = "true" ]; then
  npm publish --access public --provenance
  info "Published @yawlabs/lemonsqueezy-mcp@${VERSION} to npm (with provenance)"
elif [ -f ".github/workflows/release.yml" ] && grep -q "npm publish\|NODE_AUTH_TOKEN" .github/workflows/release.yml; then
  info "CI release.yml fires on v* tag push -- workstation hands off to CI"
  # Verify the tag landed on origin BEFORE looking up the CI run. A local
  # push that succeeded but the remote rejected (protected-tag rule, network
  # blip) would otherwise dead-end in the lookup loop with a misleading
  # "Push may have failed" error 62s later. ls-remote is one round-trip --
  # cheap relative to gh run watch.
  if ! git ls-remote --tags origin "refs/tags/v${VERSION}" 2>/dev/null | grep -q "refs/tags/v${VERSION}$"; then
    fail "Tag v${VERSION} not visible on origin. Step 4's 'git push --follow-tags' may have failed silently (protected-tag rule, network blip), or the tag was deleted between push and now. Re-run step 4."
  fi
  TAG_SHA=$(git rev-parse "v${VERSION}^{}")
  RUN_ID=""
  # Exponential backoff: 2+4+8+16+32 = 62s upper bound on GitHub's
  # tag-push -> actions queue visibility lag. Cheap relative to the CI run
  # itself (~6 min on aws-mcp).
  DELAY=2
  for i in 1 2 3 4 5; do
    RUN_ID=$(gh run list --workflow=Release --event=push --commit="$TAG_SHA" --limit=1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || echo "")
    [ -n "$RUN_ID" ] && break
    sleep $DELAY
    DELAY=$((DELAY * 2))
  done
  if [ -z "$RUN_ID" ]; then
    fail "Could not find Release workflow run for tag v${VERSION} (commit $TAG_SHA) after 62s of polling. The actions queue may be backed up; check 'gh run list --limit 5' and rerun the script to retry."
  fi
  info "Watching CI Release run $RUN_ID"
  gh run watch "$RUN_ID" --exit-status || fail "CI Release run $RUN_ID failed. See 'gh run view $RUN_ID --log-failed'."
  # CI is authoritative on the publish itself -- if `gh run watch` exited 0,
  # the package is live on npm regardless of how long the registry mirror
  # takes to surface it. Verification here is a courtesy check; warn rather
  # than fail when the mirror lags (existing memory: lag can exceed a minute).
  NPM_NOW=""
  for i in 1 2 3 4 5 6 7 8 9 10; do
    NPM_NOW=$(npm view "@yawlabs/lemonsqueezy-mcp@${VERSION}" version 2>/dev/null || echo "")
    [ "$NPM_NOW" = "$VERSION" ] && break
    sleep 6
  done
  if [ "$NPM_NOW" = "$VERSION" ]; then
    info "Published @yawlabs/lemonsqueezy-mcp@${VERSION} via CI Release run $RUN_ID"
  else
    DISPLAY_NPM="${NPM_NOW:-(not found)}"
    warn "CI Release run $RUN_ID succeeded but npm registry still shows '$DISPLAY_NPM' for @yawlabs/lemonsqueezy-mcp@${VERSION} after 60s. Likely registry propagation lag -- verify with 'npm view @yawlabs/lemonsqueezy-mcp@${VERSION}' in a minute. Publish is authoritative on CI's exit code."
  fi
else
  # Workstation IS the publisher (no CI fallback). WebAuthn-fresh sessions
  # sometimes EOTP on the first publish; retry up to 3 times with a 30s pause.
  # Only retry on EOTP/EAUTH/OTP -- a duplicate-version E403 or a packaging
  # error should fail fast, not waste 60s spinning.
  ATTEMPT=1
  MAX_ATTEMPTS=3
  while true; do
    PUBLISH_LOG=$(mktemp)
    if npm publish --access public 2>&1 | tee "$PUBLISH_LOG"; then
      rm -f "$PUBLISH_LOG"
      break
    fi
    if ! grep -qE 'EOTP|EAUTH|one-time password|OTP' "$PUBLISH_LOG"; then
      rm -f "$PUBLISH_LOG"
      fail "npm publish failed (non-OTP error -- see output above).

  If the error was E401 or E404, the automation token in ~/.npmrc is dead.
  npm answers an UNAUTHORIZED PUT with 404, not 401, so 'could not be found
  or you do not have permission' here almost always means 'not authorized'
  -- the package is fine. Confirm which it is:

      npm whoami          # E401 => the token is dead

  Fix: mint a NEW automation token (npmjs.com -> Access Tokens -> Generate
  -> Automation), then write these two lines to ~/.npmrc:

      @yawlabs:registry=https://registry.npmjs.org/
      //registry.npmjs.org/:_authToken=npm_YOURTOKEN

  Do NOT run 'npm login --auth-type=web'. It OVERWRITES the automation token
  with a 2FA-bound web session; the next publish then EOTPs on a WebAuthn
  challenge, and any CI sharing that token starts failing too."
    fi
    rm -f "$PUBLISH_LOG"
    if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
      fail "npm publish failed after $MAX_ATTEMPTS attempts (OTP not propagated)"
    fi
    warn "npm publish attempt $ATTEMPT EOTPed -- waiting 30s for WebAuthn session to propagate"
    ATTEMPT=$((ATTEMPT + 1))
    sleep 30
  done
  info "Published @yawlabs/lemonsqueezy-mcp@${VERSION} to npm (workstation)"
fi

# =============================================================================
# Step 6: Create GitHub release
# =============================================================================
step 6 "Create GitHub release"

if gh release view "v${VERSION}" >/dev/null 2>&1; then
  info "GitHub release v${VERSION} already exists -- skipping"
else
  # The notes are the version's CHANGELOG.md section, which promote_changelog
  # guarantees exists (see release_notes above); the heading itself is dropped
  # since the release page already shows the version as the title. Commit
  # subjects only when there is no CHANGELOG.md at all.
  PREV_TAG=$(git tag --sort=-v:refname | grep -A1 "^v${VERSION}$" | tail -1)
  NOTES=$(release_notes "$PREV_TAG")

  gh release create "v${VERSION}" \
    --title "v${VERSION}" \
    --notes "$NOTES"
  info "GitHub release created (notes from CHANGELOG.md [${VERSION}])"
fi

# --- npm propagation gate (part of step 7, deliberately not a step of its own) ---
#
# `npm publish` returns as soon as the registry ACCEPTS the tarball, but the
# version is not immediately readable from the CDN-backed read path. The MCP
# Registry validates by READING the package, so a registry publish that runs
# straight after `npm publish` can fail with "version 'X' was not found
# (status: 404)". ssh-mcp v0.15.3 failed exactly that way, and aws-mcp did on
# three consecutive releases (2.2.0, 2.2.1, 2.2.2). Each recovered only by
# waiting and re-running, i.e. the release cost two invocations and a human
# in the loop.
#
# Polling here makes one invocation enough (ported from aws-mcp's release.sh).
# Three deliberate choices:
#
#   * curl, not `npm view`. npm caches registry metadata (5 min by default), so
#     a poll through it can keep reporting the pre-publish answer well after the
#     version is live -- the loop would then outlast the condition it is waiting
#     on.
#   * The EXACT URL the MCP Registry fetches. Its npm validator requests
#     <base>/url.PathEscape(name)/<version>, and Go's PathEscape turns the scope
#     slash into %2F (`@yawlabs%2Fpkg`, the `@` left bare). A literal-slash URL
#     reaches the same origin but can be a different CDN cache entry, so success
#     there would be a proxy rather than evidence about the path that fails.
#   * WARN, never fail, on timeout. If propagation is genuinely stuck, letting
#     mcp-publisher run produces its own precise error naming the version and
#     status; a timeout message from this loop would replace that with something
#     strictly less informative. This gate can only make the release faster,
#     never worse than it was before it existed.
if [ "${SKIP_NPM_WAIT:-}" = "1" ]; then
  warn "SKIP_NPM_WAIT=1 -- not waiting for npm to serve v${VERSION}"
elif ! command -v curl >/dev/null 2>&1; then
  warn "curl not found -- skipping the npm propagation wait; step 7 may 404 on a fresh publish"
else
  PKG_NAME=$(node -p "require('./package.json').name")
  NPM_WAIT_URL="https://registry.npmjs.org/${PKG_NAME//\//%2F}/${VERSION}"
  NPM_WAIT_TIMEOUT_S=${NPM_WAIT_TIMEOUT_S:-300}
  NPM_WAITED_S=0
  # 5s: this is a remote read on a minutes-scale wait, so a tighter spin buys
  # nothing. (Under MSYS every `sleep` forks a process -- ~0.1s each -- which is
  # noise at this interval but the reason not to poll sub-second.)
  while [ "$NPM_WAITED_S" -lt "$NPM_WAIT_TIMEOUT_S" ]; do
    if curl -fsS -o /dev/null "$NPM_WAIT_URL" 2>/dev/null; then
      break
    fi
    sleep 5
    NPM_WAITED_S=$((NPM_WAITED_S + 5))
  done
  if [ "$NPM_WAITED_S" -ge "$NPM_WAIT_TIMEOUT_S" ]; then
    warn "npm still does not serve ${PKG_NAME}@${VERSION} after ${NPM_WAIT_TIMEOUT_S}s -- continuing anyway so the registry step can report the precise error"
  elif [ "$NPM_WAITED_S" -gt 0 ]; then
    info "npm is serving v${VERSION} (waited ${NPM_WAITED_S}s for propagation)"
  else
    info "npm is already serving v${VERSION}"
  fi
fi

# =============================================================================
# Step 7: Publish to the Official MCP Registry
# =============================================================================
# Downstream catalogs (Glama, PulseMCP, mcpservers.org) auto-source from the
# Official MCP Registry; publishing here is what makes the new version visible
# to them. server.json was already bumped in step 3 so the version matches the
# tag.
step 7 "Publish to MCP Registry"

if [ ! -f server.json ]; then
  info "No server.json -- not an MCP server, skipping registry publish"
else
  # Post-publish smoke test (ported from the old release.yml): the release is
  # live on npm, so confirm that a fresh install via npx can execute the binary
  # and respond to --version before claiming a working release on the registry
  # surface. Catches packaging regressions (missing bin shebang, bad "files"
  # entry, broken esbuild output) before the registry surface points at them.
  #
  # Run npx from a temp dir -- if run from the checkout root, npx sees our own
  # package.json `bin` entry and tries to resolve the local (unbuilt) path
  # instead of installing the published tarball.
  SMOKE_DIR=$(mktemp -d)
  ATTEMPTS=30
  SLEEP_SECONDS=10
  SMOKE_OUTPUT=""
  STARTED_AT=$(date +%s)
  for i in $(seq 1 $ATTEMPTS); do
    if SMOKE_OUTPUT=$(cd "$SMOKE_DIR" && npx -y "@yawlabs/lemonsqueezy-mcp@${VERSION}" --version 2>/dev/null); then
      info "smoke test: npx output '$SMOKE_OUTPUT' (after $(( $(date +%s) - STARTED_AT ))s)"
      break
    fi
    warn "waiting for @yawlabs/lemonsqueezy-mcp@${VERSION} to be installable via npx (attempt $i/$ATTEMPTS, ${SLEEP_SECONDS}s)..."
    sleep $SLEEP_SECONDS
  done
  rm -rf "$SMOKE_DIR"
  if [ "$SMOKE_OUTPUT" != "$VERSION" ]; then
    fail "smoke test: expected $VERSION, got '${SMOKE_OUTPUT:-<empty>}' after $ATTEMPTS attempts ($(( $(date +%s) - STARTED_AT ))s). Not advancing to MCP Registry publish."
  fi

  # mcp-publisher binary cached at ~/.local/bin. Pinned to "latest" upstream;
  # if the registry's CLI introduces a breaking change, the next release will
  # surface it. The OS/arch detection handles Linux, macOS, and Git Bash on
  # Windows (MINGW/MSYS uname -s starts with "mingw" / "msys").
  MP="${MCP_PUBLISHER:-$HOME/.local/bin/mcp-publisher}"
  if ! [ -x "$MP" ]; then
    info "mcp-publisher not found at $MP -- downloading"
    mkdir -p "$(dirname "$MP")"
    OS_RAW=$(uname -s | tr '[:upper:]' '[:lower:]')
    case "$OS_RAW" in mingw*|msys*|cygwin*) OS=windows ;; *) OS="$OS_RAW" ;; esac
    ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
    TMP=$(mktemp -d)
    curl -sL -o "$TMP/mp.tar.gz" \
      "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_${OS}_${ARCH}.tar.gz" \
      || fail "Failed to download mcp-publisher (${OS}/${ARCH})"
    tar xzf "$TMP/mp.tar.gz" -C "$TMP" || fail "Failed to extract mcp-publisher tarball"
    if [ -f "$TMP/mcp-publisher.exe" ]; then
      mv "$TMP/mcp-publisher.exe" "$MP"
    else
      mv "$TMP/mcp-publisher" "$MP"
    fi
    rm -rf "$TMP"
    chmod +x "$MP" 2>/dev/null || true
  fi

  # OIDC auth (used by the old release.yml) only works inside Actions; locally
  # we use a GitHub PAT via `login github -token <PAT>`. The PAT needs read:org
  # for YawLabs so the registry can verify org membership for the
  # io.github.YawLabs/* namespace.
  # Fall back to gh CLI's session token if MCP_REGISTRY_TOKEN is unset --
  # gh auth login (admin:org or read:org scope) covers the namespace claim.
  : "${MCP_REGISTRY_TOKEN:=$(gh auth token 2>/dev/null || true)}"
  if [ -z "${MCP_REGISTRY_TOKEN:-}" ]; then
    fail "MCP_REGISTRY_TOKEN unset -- set it to a GitHub PAT with read:org for YawLabs (or run '$MP login github' once interactively to cache the session)."
  fi
  "$MP" login github -token "$MCP_REGISTRY_TOKEN" >/dev/null 2>&1 \
    || fail "mcp-publisher login failed -- check MCP_REGISTRY_TOKEN scopes (needs read:org for YawLabs)"
  "$MP" publish \
    || fail "mcp-publisher publish failed -- npm + GitHub release succeeded, but the MCP Registry did not. Retry the step (re-run the script) once the cause is identified."
  info "Published to MCP Registry"
fi

# =============================================================================
# Step 8: Verify
# =============================================================================
step 8 "Verify"

sleep 3

NPM_VERSION=$(npm view "@yawlabs/lemonsqueezy-mcp@${VERSION}" version 2>/dev/null || echo "")
if [ "$NPM_VERSION" = "$VERSION" ]; then
  info "npm: @yawlabs/lemonsqueezy-mcp@${NPM_VERSION}"
else
  warn "npm shows ${NPM_VERSION:-nothing} (expected $VERSION -- may still be propagating)"
fi

PKG_VERSION=$(node -p "require('./package.json').version")
if [ "$PKG_VERSION" = "$VERSION" ]; then
  info "package.json: ${PKG_VERSION}"
else
  warn "package.json shows ${PKG_VERSION} (expected $VERSION)"
fi

if git tag -l "v${VERSION}" | grep -q "v${VERSION}"; then
  info "git tag: v${VERSION}"
else
  warn "git tag v${VERSION} not found"
fi

# Provenance attestation check — npm attaches sigstore attestations when
# `npm publish --provenance` runs inside GitHub Actions (CI mode, which no
# workflow invokes today -- see the header). A missing attestation is not
# fatal for local runs (we publish without --provenance there), but in CI it
# means something regressed.
if [ "$IS_CI" = "true" ]; then
  ATTEST=$(npm view "@yawlabs/lemonsqueezy-mcp@${VERSION}" dist.attestations.provenance.predicateType 2>/dev/null || echo "")
  if [ -n "$ATTEST" ]; then
    info "provenance attestation: $ATTEST"
  else
    warn "no provenance attestation found on v${VERSION} (expected in CI publish)"
  fi
fi

# =============================================================================
echo ""
echo -e "${GREEN}  v${VERSION} released successfully${NC}"
echo ""
echo -e "  npm:    https://www.npmjs.com/package/@yawlabs/lemonsqueezy-mcp"
echo -e "  github: https://github.com/YawLabs/lemonsqueezy-mcp/releases/tag/v${VERSION}"
echo ""
