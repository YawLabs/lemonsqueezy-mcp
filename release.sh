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
#   - Node.js 20+
#   - npm authenticated as a publisher of @yawlabs/lemonsqueezy-mcp
#       npm login --auth-type=web
#   - GitHub CLI authenticated
#       gh auth login
#
# Prerequisites for CI runs:
#   - $CI=true
#   - $GITHUB_REF_NAME=vX.Y.Z (set automatically by the tag-push trigger)
#   - $NODE_AUTH_TOKEN populated from secrets.NPM_TOKEN (org-level)
#   - $GITHUB_TOKEN populated automatically by Actions
#
# Either path produces an identical artifact; the typical workflow is to bump
# + commit + tag + push locally and let CI handle steps 5-6 via the tag-push
# trigger in .github/workflows/release.yml.
# =============================================================================

set -euo pipefail
trap 'echo -e "\n\033[0;31m  x Release failed at line $LINENO (exit code $?)\033[0m"' ERR

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

TOTAL_STEPS=7
step() { echo -e "\n${CYAN}=== [$1/$TOTAL_STEPS] $2 ===${NC}"; }
info() { echo -e "${GREEN}  + $1${NC}"; }
warn() { echo -e "${YELLOW}  ! $1${NC}"; }
fail() { echo -e "${RED}  x $1${NC}"; exit 1; }

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
  npm whoami >/dev/null 2>&1     || fail "npm is not authenticated. Run: npm login --auth-type=web"

  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [ "$CURRENT_BRANCH" != "main" ]; then
    fail "Must release from 'main' branch (currently on '$CURRENT_BRANCH')"
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
  echo "  7. Verify"
  echo ""
  read -p "Continue? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
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
  info "Version bumped"
fi

# =============================================================================
# Step 4: Commit, tag, and push (skipped in CI -- the tag is what triggered us)
# =============================================================================
step 4 "Commit, tag, and push"
if [ "$IS_CI" = "true" ]; then
  info "CI mode -- skipping commit/tag/push (tag $GITHUB_REF_NAME already triggered this run)"
else
  if [ -n "$(git status --porcelain package.json package-lock.json 2>/dev/null)" ]; then
    git add package.json package-lock.json
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

  git push origin main --follow-tags
  info "Pushed main + tags to origin"
fi

# =============================================================================
# Step 5: Publish to npm
# =============================================================================
step 5 "Publish to npm"

PUBLISHED_VERSION=$(npm view "@yawlabs/lemonsqueezy-mcp@${VERSION}" version 2>/dev/null || echo "")
if [ "$PUBLISHED_VERSION" = "$VERSION" ]; then
  info "v${VERSION} already published on npm -- skipping"
elif [ "$IS_CI" = "true" ]; then
  npm publish --access public --provenance
  info "Published @yawlabs/lemonsqueezy-mcp@${VERSION} to npm (with provenance)"
else
  # WebAuthn-fresh sessions sometimes EOTP on the first publish; retry up to
  # 3 times with a 30s pause before giving up. See @yawlabs CLAUDE.md note.
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
      fail "npm publish failed (non-OTP error -- see output above)"
    fi
    rm -f "$PUBLISH_LOG"
    if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
      fail "npm publish failed after $MAX_ATTEMPTS attempts (OTP not propagated)"
    fi
    warn "npm publish attempt $ATTEMPT EOTPed -- waiting 30s for WebAuthn session to propagate"
    ATTEMPT=$((ATTEMPT + 1))
    sleep 30
  done
  info "Published @yawlabs/lemonsqueezy-mcp@${VERSION} to npm"
fi

# =============================================================================
# Step 6: Create GitHub release
# =============================================================================
step 6 "Create GitHub release"

if gh release view "v${VERSION}" >/dev/null 2>&1; then
  info "GitHub release v${VERSION} already exists -- skipping"
else
  # Prefer the section from CHANGELOG.md for richer GH release notes -- the
  # body between `## [VERSION] -- ...` and the next `## [`, with the heading
  # itself dropped (the release page already shows the version as the title).
  # Falls back to commit subjects, then "Initial release", if no section is
  # present or it's whitespace-only.
  RELEASE_NOTES=""
  if [ -f CHANGELOG.md ]; then
    # index() avoids regex bracket-escaping headaches that awk warns about.
    RELEASE_NOTES=$(awk -v target="## [${VERSION}]" '
      index($0, target) == 1 { found=1; next }
      found && index($0, "## [") == 1 { exit }
      found { print }
    ' CHANGELOG.md)
  fi

  if [ -z "$(printf '%s' "$RELEASE_NOTES" | tr -d '[:space:]')" ]; then
    PREV_TAG=$(git tag --sort=-v:refname | grep -A1 "^v${VERSION}$" | tail -1)
    if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "v${VERSION}" ]; then
      RELEASE_NOTES=$(git log --oneline "${PREV_TAG}..v${VERSION}" --no-decorate | sed 's/^[a-f0-9]* /- /')
      info "No CHANGELOG.md section for v${VERSION} -- using commit subjects"
    else
      RELEASE_NOTES="Initial release"
    fi
  else
    info "Using CHANGELOG.md section for v${VERSION}"
  fi

  gh release create "v${VERSION}" \
    --title "v${VERSION}" \
    --notes "$RELEASE_NOTES"
  info "GitHub release created"
fi

# =============================================================================
# Step 7: Verify
# =============================================================================
step 7 "Verify"

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
# `npm publish --provenance` runs inside GitHub Actions (which is our CI path).
# A missing attestation is not fatal for local runs (we publish without
# --provenance there), but in CI it means something regressed.
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
