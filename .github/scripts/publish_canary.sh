#!/bin/bash
#
# Used in the publish-canary.yml GitHub Action workflow.

set -euo pipefail

echo "//registry.npmjs.org/:_authToken=${NPM_AUTH_TOKEN}" > .npmrc

if [[ -z "$NPM_AUTH_TOKEN" ]]; then
  echo "Error: NPM_AUTH_TOKEN is not set or is empty"
  exit 1
fi

# Make sure the token is valid and not expired using `npm whoami`
echo "npm user: $(npm whoami)"

# Make sure the token is valid and not expired using the `npm` cli, piping to jq
# and finding a key with "cedarjs" org scope. Make sure "expiry" is in the
# future.
#
# Example output
#
# [
#   {
#     "name": "cedarjs",
#     "description": "",
#     "key": "***",
#     "token": "npm_oOk8...",
#     "expiry": "2026-05-06T17:05:58.951Z",
#     "cidr": [],
#     "bypass_2fa": true,
#     "revoked": null,
#     "created": "2026-02-05T17:05:58.963Z",
#     "updated": "2026-02-05T17:05:58.963Z",
#     "accessed": null,
#     "permissions": [
#       {
#         "name": "package",
#         "action": "write"
#       },
#       {
#         "name": "org",
#         "action": "write"
#       }
#     ],
#     "scopes": [
#       {
#         "name": null,
#         "type": "package"
#       },
#       {
#         "name": "cedarjs",
#         "type": "org"
#       }
#     ]
#   },
#   {
#     "name": "some_name",
#     "description": "Publishing Some Org packages to npm from GitHub CI",
#     "key": "***",
#     "token": "npm_amVL...",
#     "expiry": "2026-02-03T20:06:18.920Z",
#     "cidr": [],
#     "bypass_2fa": true,
#     "revoked": null,
#     "created": "2025-04-17T05:49:40.258Z",
#     "updated": "2025-11-05T20:06:18.920Z",
#     "accessed": "2025-05-18T22:26:57.163Z",
#     "permissions": [
#       {
#         "name": "package",
#         "action": "write"
#       }
#     ],
#     "scopes": [
#       {
#         "name": "create-some-app",
#         "type": "package"
#       },
#       {
#         "name": "storybook-framework-something",
#         "type": "package"
#       },
#       {
#         "name": "@orgscope",
#         "type": "package"
#       }
#     ]
#   }
# ]

tokens=$(npm token list --json)

if [[ $? -ne 0 ]]; then
  echo "Error: Failed to list npm tokens. Is NPM_AUTH_TOKEN valid?"
  exit 1
fi

current_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

valid_token=$(echo "$tokens" | jq -r --arg now "$current_time" '
  .[]
  | select(any(.scopes[]?; .name == "cedarjs" and .type == "org"))
  | select(.expiry == null or .expiry > $now)
  | .token
')

if [[ -z "$valid_token" ]]; then
  echo "Error: No valid, non-expired NPM token found for 'cedarjs' org scope"
  echo "Current tokens:"
  echo "$tokens" | jq .
  exit 1
fi

echo "NPM token for 'cedarjs' org scope is valid and not expired"

TAG='canary' && [[ "$GITHUB_REF_NAME" = 'next' ]] && TAG='next'
echo "Publishing $TAG from $GITHUB_REF_NAME using npm token ${NPM_AUTH_TOKEN:0:5}"

# ── Calculate version ──────────────────────────────────────────────────────────

LATEST_TAG=$(git describe --abbrev=0 --tags)
echo "Latest tag: $LATEST_TAG"

COMMIT_COUNT=$(git rev-list --count "${LATEST_TAG}..HEAD")
echo "Commits since tag: $COMMIT_COUNT"

CURRENT_VERSION="${LATEST_TAG#v}"
echo "Current version: $CURRENT_VERSION"

MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
MINOR=$(echo "$CURRENT_VERSION" | cut -d. -f2)
PATCH=$(echo "$CURRENT_VERSION" | cut -d. -f3)

if [[ "$GITHUB_REF_NAME" = 'main' ]]; then
  BASE_VERSION="$((MAJOR + 1)).0.0"
else
  BASE_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
fi

CANARY_VERSION="${BASE_VERSION}-${TAG}.${COMMIT_COUNT}"
echo "Canary version: $CANARY_VERSION"

# ── Update all packages to canary version ──────────────────────────────────────

echo "Updating package versions to $CANARY_VERSION"

framework_dir="$(cd "$(dirname "$0")" && pwd)/../.."

# Use a tempfile for sed compatibility across platforms
workspaces=$(yarn workspaces list --json)

while IFS= read -r line; do
  location=$(echo "$line" | jq -r '.location')

  if [[ "$location" == "." ]]; then
    continue
  fi

  pkg_json_path="$framework_dir/$location/package.json"

  if [ ! -f "$pkg_json_path" ]; then
    echo "ERROR: No package.json at $location/package.json"
    exit 1
  fi

  # Update version field in package.json using jq
  tmpfile=$(mktemp)
  jq --arg ver "$CANARY_VERSION" '.version = $ver' "$pkg_json_path" > "$tmpfile" \
    && mv "$tmpfile" "$pkg_json_path"
  echo "  Updated $location/package.json"
done <<< "$workspaces"

# ── Update workspace:* dependencies ────────────────────────────────────────────

echo "Updating workspace:* dependencies to $CANARY_VERSION"

while IFS= read -r line; do
  location=$(echo "$line" | jq -r '.location')

  if [[ "$location" == "." ]]; then
    continue
  fi

  pkg_json_path="$framework_dir/$location/package.json"

  tmpfile=$(mktemp)
  jq \
    --arg ver "$CANARY_VERSION" \
    '
      if .dependencies then
        .dependencies |= with_entries(
          if .value == "workspace:*" then .value = $ver else . end
        )
      else . end
      | if .devDependencies then
          .devDependencies |= with_entries(
            if .value == "workspace:*" then .value = $ver else . end
          )
        else . end
    ' "$pkg_json_path" > "$tmpfile" && mv "$tmpfile" "$pkg_json_path"

  echo "  Updated $location/package.json workspace deps"
done <<< "$workspaces"

# ── Update create-cedar-app templates and overlays ─────────────────────────────

echo "Updating create-cedar-app templates to $CANARY_VERSION"

find "$framework_dir/packages/create-cedar-app/templates" \
  "$framework_dir/packages/create-cedar-app/database-overlays" \
  -name "package.json" \
  | while IFS= read -r pkg_json; do
    tmpfile=$(mktemp)
    jq --arg ver "$CANARY_VERSION" '
      if .dependencies then
        .dependencies |= with_entries(
          if .key | startswith("@cedarjs/") then .value = $ver else . end
        )
      else . end
      | if .devDependencies then
          .devDependencies |= with_entries(
            if .key | startswith("@cedarjs/") then .value = $ver else . end
          )
        else . end
    ' "$pkg_json" > "$tmpfile" && mv "$tmpfile" "$pkg_json"
    echo "  Updated $(basename "$(dirname "$pkg_json")")/package.json"
  done

# ── Commit the changes ─────────────────────────────────────────────────────────

git config user.name "GitHub Actions"
git config user.email "<>"

git commit -am "Update packages and templates to canary version $CANARY_VERSION"

# ── Publish all packages ───────────────────────────────────────────────────────

echo "Publishing all packages with tag $TAG"

while IFS= read -r line; do
  location=$(echo "$line" | jq -r '.location')

  if [[ "$location" == "." ]]; then
    continue
  fi

  pkg_json_path="$framework_dir/$location/package.json"
  is_private=$(jq -r '.private // false' "$pkg_json_path")

  if [[ "$is_private" == "true" ]]; then
    echo "Skipping private package at $location"
    continue
  fi

  package_name=$(jq -r '.name' "$pkg_json_path")
  package_version=$(jq -r '.version' "$pkg_json_path")

  echo "Publishing $package_name@$package_version..."

  # Check if already published
  if npm view "$package_name@$package_version" version &> /dev/null; then
    echo "  Already published, skipping"
    continue
  fi

  (cd "$framework_dir/$location" && npm publish --tag "$TAG" --access public)
  echo "  ✅ Published $package_name@$package_version"
done <<< "$workspaces"

echo "✅ Canary publishing completed successfully!"
