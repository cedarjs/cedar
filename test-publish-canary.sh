#!/bin/bash
#
# Local test script to simulate the canary publish flow without actually publishing.
# This helps debug issues that occur in CI during the publish process.

set -e

echo "🔍 Testing canary publish flow locally..."
echo ""

# Check for uncommitted changes before we start
echo "📋 Current git status:"
git status --short
echo ""

# Simulate what CI does - CI doesn't have Nx cache so we skip it too
echo "🧹 Running linter..."
yarn lint
echo ""

echo "🧪 Running tests (without cache, like CI)..."
echo "Note: Using --skip-nx-cache to replicate CI environment"
NX_SKIP_NX_CACHE=true yarn test
echo ""

# Check for uncommitted changes after tests
echo "📋 Git status after tests:"
git status --short
echo ""

# Create .npmrc like the publish script does (but with a dummy token)
echo "📝 Creating .npmrc (with dummy token)..."
echo "//registry.npmjs.org/:_authToken=npm_TEST_TOKEN" > .npmrc

# Check what lerna would see
echo "📋 Git status after creating .npmrc:"
git status --short
echo ""

# Try a dry-run of lerna publish
echo "🚀 Testing lerna publish (dry-run)..."
TAG='canary'
args=(
  premajor
  --include-merged-tags
  --canary
  --exact
  --preid "$TAG"
  --dist-tag "$TAG"
  --force-publish
  --loglevel verbose
  --no-git-reset
)

echo "Note: If this fails with EUNCOMMIT, it means tests generated files that differ from git."
echo ""

echo 'n' | yarn lerna publish "${args[@]}" 2>&1 | tee publish_output || {
  echo ""
  echo "❌ Lerna publish failed!"
  echo ""
  echo "Git status at failure:"
  git status --short
  echo ""
  echo "Git diff for modified files:"
  git diff --stat
  exit 1
}

echo ""
echo "✅ Test completed successfully!"
echo ""
echo "🧹 Cleaning up test artifacts..."
rm -f .npmrc publish_output canary_version

echo "Done! If this script passes, the CI should work too."
