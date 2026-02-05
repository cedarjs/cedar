#!/bin/bash
#
# Used in the publish-canary.yml GitHub Action workflow.

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

args=()

if [[ "$GITHUB_REF_NAME" = 'main' ]]; then
  args+=(premajor)
fi

args+=(
  --include-merged-tags
  --canary
  --exact
  --preid "$TAG"
  --dist-tag "$TAG"
  --force-publish
  --loglevel verbose
  --no-git-reset
)

# `echo 'n'` to answer "no" to the "Are you sure you want to publish these
#   packages?" prompt.
# `2>&1` to pipe both stdout and stderr to grep. Mostly do this keep the github
#   action output clean.
# At the end we use awk to increase the commit count by 1, because we'll commit
#   updated package.jsons in the next step, which will increase the final
#   number that lerna will use when publishing the canary packages.
echo 'n' \
  | yarn lerna publish "${args[@]}" 2>&1 \
    > publish_output
cat publish_output \
  | grep -E '\-canary\.|\-next\.' \
  | tail -n 1 \
  | sed 's/.*=> //' \
  | sed 's/\+.*//' \
  | awk -F. '{ $NF = $NF + 1 } 1' OFS=. \
    > canary_version

if [ ! -s canary_version ]; then
  echo "The canary_version file is empty or does not exist."
  echo "'yarn lerna publish' output was:"
  echo "---------------\n"
  cat publish_output
  echo "---------------\n"

  exit 1
fi

# Update create-cedar-app templates to use canary packages

sed "s/\"@cedarjs\/\(.*\)\": \".*\"/\"@cedarjs\/\1\": \"$(cat canary_version)\"/" \
  packages/create-cedar-app/templates/js/package.json > tmpfile \
  && mv tmpfile packages/create-cedar-app/templates/js/package.json
sed "s/\"@cedarjs\/\(.*\)\": \".*\"/\"@cedarjs\/\1\": \"$(cat canary_version)\"/" \
  packages/create-cedar-app/templates/js/api/package.json > tmpfile \
  && mv tmpfile packages/create-cedar-app/templates/js/api/package.json
sed "s/\"@cedarjs\/\(.*\)\": \".*\"/\"@cedarjs\/\1\": \"$(cat canary_version)\"/" \
  packages/create-cedar-app/templates/js/web/package.json > tmpfile \
  && mv tmpfile packages/create-cedar-app/templates/js/web/package.json

sed "s/\"@cedarjs\/\(.*\)\": \".*\"/\"@cedarjs\/\1\": \"$(cat canary_version)\"/" \
  packages/create-cedar-app/templates/ts/package.json > tmpfile \
  && mv tmpfile packages/create-cedar-app/templates/ts/package.json
sed "s/\"@cedarjs\/\(.*\)\": \".*\"/\"@cedarjs\/\1\": \"$(cat canary_version)\"/" \
  packages/create-cedar-app/templates/ts/api/package.json > tmpfile \
  && mv tmpfile packages/create-cedar-app/templates/ts/api/package.json
sed "s/\"@cedarjs\/\(.*\)\": \".*\"/\"@cedarjs\/\1\": \"$(cat canary_version)\"/" \
  packages/create-cedar-app/templates/ts/web/package.json > tmpfile \
  && mv tmpfile packages/create-cedar-app/templates/ts/web/package.json

# Update all packages to replace any "workspace:*" with this canary version

framework_dir="$(cd "$(dirname "$0")" && pwd)/../.."
ws="$(yarn workspaces list --json)"

IFS=$'\n'
for line in $ws; do
  location=$(
    echo "$line" \
      | jq -r '.location'
  )

  relative_pkg_json_path="$location/package.json"

  if [[ $location == "." ]]; then
    printf "Skipping:\t%s\n" "$relative_pkg_json_path"
    continue
  fi

  pkg_json_path="$framework_dir/$relative_pkg_json_path"
  if [ ! -f "$pkg_json_path" ]; then
    printf "ERROR:\nNo package.json found at%s\n" "$relative_pkg_json_path"
    exit 1
  fi

  printf "Processing:\t%s\n" "$relative_pkg_json_path"
  sed "s/workspace:\*/$(cat canary_version)/g" "$pkg_json_path" > tmpfile \
    && mv tmpfile "$pkg_json_path"
done

# Commit the changes
git config user.name "GitHub Actions"
git config user.email "<>"

git commit -am "Update create-cedar-app templates to use canary packages"

args+=(--yes)
yarn lerna publish "${args[@]}"
