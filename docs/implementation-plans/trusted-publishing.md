# npm trusted publishing

All publishing from this repo goes through `.github/workflows/publish.yml` using
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC). No
long-lived npm token is involved: the job has `id-token: write`, GitHub issues a
short-lived ID token, and npm trades it for a credential that can only publish
the one package it was minted for. Provenance attestations come for free.

## Why one workflow file

npm allows **one** trusted publisher per package, identified by repo + workflow
file name (+ optional environment). That's why canaries, RCs, stable releases
and the nightly staging-tag cleanup are all jobs in `publish.yml`. Renaming that
file breaks publishing for every package until the trusted publisher config on
npmjs.com is updated.

## Why there's a token exchange helper

Only `npm publish` performs the OIDC exchange. `npm dist-tag`, which the
staging-tag flow relies on, does not. `.github/scripts/lib/npm-auth.mts` does
the same exchange the npm CLI does internally
(`POST /-/npm/v1/oidc/token/exchange/package/<name>`) and hands the resulting
token to `npm dist-tag` through a throwaway user config. The scripts still honor
`NPM_AUTH_TOKEN` if it's set, so the migration can be done in steps.

## Rollout checklist

1. Merge the `publish.yml` change. Nothing changes yet: the scripts keep using
   `NPM_AUTH_TOKEN` while the secret exists.
2. Configure npm trusted publishing for **every** published package (all
   non-private workspaces, ~70 of them, plus `create-cedar-app`). Run
   `.github/scripts/configure-trusted-publishers.mts` (requires npm CLI 11.15.0
   or later, 2FA enabled on the npm account, and publish access to every
   package):

   ```
   node .github/scripts/configure-trusted-publishers.mts --dry-run  # preview
   node .github/scripts/configure-trusted-publishers.mts             # apply
   ```

   It runs `npm trust github <package> --repo cedarjs/cedar --file publish.yml --allow-publish --yes` for each package, leaving the environment blank (only the `release` job uses one). A single package can also be configured by hand with `npm trust`, or through npmjs.com's per-package Settings → Publishing access → Trusted publisher UI.

3. Run the `release` job manually with `dry-run: true` against the latest
   release tag (Actions → 🚢 Publish → Run workflow). Besides packing every
   package, a dry run does one no-op `npm dist-tag add` on `@cedarjs/core`,
   which proves the exchange-for-dist-tag path works. Do this **after** deleting
   `NPM_AUTH_TOKEN` (or temporarily removing it) so the run really uses OIDC.
4. Delete the `NPM_AUTH_TOKEN` secret from the repo. Revoke the token on
   npmjs.com.
5. Optionally, per package on npmjs.com: "Require two-factor authentication and
   disallow tokens" so the trusted publisher is the only way to publish.
6. Configure the `npm-release` environment in the repo settings (required
   reviewers) if a human approval step is wanted before a stable release is
   published.

## Things to remember

- Trusted publishing cannot create packages. A brand-new workspace needs a first
  manual publish (with a token) and its own trusted publisher config before it
  can be part of a release. `publish-release.mts` checks for this before
  publishing anything.
- The `release` job runs when a `vX.Y.Z` tag is pushed. The tagged commit must
  already have versions bumped and the create-cedar-app templates updated (the
  release tooling does this); the script verifies it and refuses otherwise.
- Only GitHub-hosted runners are supported.
- The release tooling identifies CI runs by workflow name. With the
  consolidation it has to look at the job (`🏎 Publish Release Candidate`) inside
  the `🚢 Publish` workflow instead of a workflow with that name.
