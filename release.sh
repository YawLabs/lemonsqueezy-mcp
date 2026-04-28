#!/bin/bash
# =============================================================================
# Release script — local deploy: lint, test, build, tag, publish, GitHub release
# =============================================================================
# Usage:
#   ./release.sh <version>      e.g. ./release.sh 0.6.0
#
# If interrupted, re-run with the same version. Each step is idempotent:
# already-bumped, already-tagged, already-published, and already-released
# states are detected and skipped.
#
# Prerequisites (one-time setup on this machine):
#   - Node.js 18+
#   - npm authenticated as a publisher of @yawlabs/lemonsqueezy-mcp
#       npm login --auth-type=web
#   - GitHub CLI authenticated
#       gh auth login
#
# Notes:
#   - This package no longer uses GitHub Actions; this script is the only
#     supported way to cut a release. Run it from a clean working tree on
#     the main branch.
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

# ---- Resolve version ----
VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: ./release.sh <version>"
  echo "  e.g. ./release.sh 0.6.0"
  exit 1
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
command -v gh   >/dev/null || fail "gh not installed (https://cli.github.com)"

gh auth status >/dev/null 2>&1 || fail "gh is not authenticated. Run: gh auth login"
npm whoami >/dev/null 2>&1     || fail "npm is not authenticated. Run: npm login --auth-type=web"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  fail "Must release from 'main' branch (currently on '$CURRENT_BRANCH')"
fi

CURRENT_VERSION=$(node -p "require('./package.json').version")
RESUMING=false

if [ "$CURRENT_VERSION" = "$VERSION" ]; then
  RESUMING=true
  info "package.json already at v${VERSION} — resuming a previous run"
else
  if [ -n "$(git status --porcelain)" ]; then
    fail "Working directory not clean. Commit or stash changes first."
  fi
  info "Current: v${CURRENT_VERSION} -> v${VERSION}"
fi

if [ "$RESUMING" != "true" ]; then
  echo ""
  echo -e "${YELLOW}About to release v${VERSION}. This will:${NC}"
  echo "  1. Lint"
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
step 1 "Lint"
npm run lint || fail "Lint failed (try: npm run lint:fix)"
info "Lint passed"

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
  info "Already at v${VERSION} — skipping"
else
  npm version "$VERSION" --no-git-tag-version
  info "Version bumped"
fi

# =============================================================================
# Step 4: Commit, tag, and push
# =============================================================================
step 4 "Commit, tag, and push"

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
  git tag "v${VERSION}"
  info "Tag v${VERSION} created"
fi

git push origin main --follow-tags
info "Pushed main + tags to origin"

# =============================================================================
# Step 5: Publish to npm
# =============================================================================
step 5 "Publish to npm"

PUBLISHED_VERSION=$(npm view @yawlabs/lemonsqueezy-mcp version 2>/dev/null || echo "")
if [ "$PUBLISHED_VERSION" = "$VERSION" ]; then
  info "v${VERSION} already published on npm — skipping"
else
  # WebAuthn-fresh sessions sometimes EOTP on the first publish; retry up to
  # 3 times with a 30s pause before giving up. See @yawlabs CLAUDE.md note.
  ATTEMPT=1
  MAX_ATTEMPTS=3
  until npm publish --access public; do
    if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
      fail "npm publish failed after $MAX_ATTEMPTS attempts"
    fi
    warn "npm publish attempt $ATTEMPT failed — waiting 30s and retrying"
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
  info "GitHub release v${VERSION} already exists — skipping"
else
  PREV_TAG=$(git tag --sort=-v:refname | grep -A1 "^v${VERSION}$" | tail -1)
  if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "v${VERSION}" ]; then
    CHANGELOG=$(git log --oneline "${PREV_TAG}..v${VERSION}" --no-decorate | sed 's/^[a-f0-9]* /- /')
  else
    CHANGELOG="Initial release"
  fi

  gh release create "v${VERSION}" \
    --title "v${VERSION}" \
    --notes "$CHANGELOG"
  info "GitHub release created"
fi

# =============================================================================
# Step 7: Verify
# =============================================================================
step 7 "Verify"

sleep 3

NPM_VERSION=$(npm view @yawlabs/lemonsqueezy-mcp version 2>/dev/null || echo "")
if [ "$NPM_VERSION" = "$VERSION" ]; then
  info "npm: @yawlabs/lemonsqueezy-mcp@${NPM_VERSION}"
else
  warn "npm shows ${NPM_VERSION:-nothing} (expected $VERSION — may still be propagating)"
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

# =============================================================================
echo ""
echo -e "${GREEN}  v${VERSION} released successfully${NC}"
echo ""
echo -e "  npm:    https://www.npmjs.com/package/@yawlabs/lemonsqueezy-mcp"
echo -e "  github: https://github.com/YawLabs/lemonsqueezy-mcp/releases/tag/v${VERSION}"
echo ""
