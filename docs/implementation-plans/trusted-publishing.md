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

## Why the prerelease and cleanup jobs still use a token

Trusted publishing only covers `npm publish`. It cannot write dist-tags
([npm/cli#8547](https://github.com/npm/cli/issues/8547)), and the credential
npm mints for a publish is rejected by the dist-tag endpoint. Canary publishing
relies on dist-tag writes (publish under a staging tag, then flip every package
to `canary`), so the `prerelease` and `cleanup-staging-tags` jobs get
`NPM_AUTH_TOKEN`, and `.github/scripts/lib/npm-auth.mts` refuses dist-tag
writes in OIDC mode with a pointer to that issue. The token can go once
canaries no longer need dist-tags; see
[`2026-09-06-canary-releases-on-pkg-pr-new.md`](./2026-09-06-canary-releases-on-pkg-pr-new.md).

## How a release is published without dist-tag writes

`publish-release.mts` publishes straight under the release dist-tag (`latest`,
or `patch` for a patch to an older major), in dependency order, one level at a
time, waiting for the registry to serve each level before starting the next.
`@cedarjs/core` is published after every other `@cedarjs` package, and
`create-cedar-app` last. That order is what stands in for the atomic flip:

- Nothing is ever on the registry before the in-monorepo packages it depends
  on, so a version that resolves mid-run can be installed.
- `yarn cedar upgrade` resolves its target version from `@cedarjs/core` alone
  and pins every package to it, so upgrades only see the release once the
  packages they will pin are all there.
- `yarn create cedar-app` keeps scaffolding the previous, self-consistent
  release until `create-cedar-app` is published.

Re-running the job after a failure is safe: already published versions are
skipped.

## Rollout checklist

1. Configure npm trusted publishing for **every** published package (all
   non-private workspaces, ~70 of them, plus `create-cedar-app`). Run
   `.github/scripts/configure-trusted-publishers.mts` (requires npm CLI 11.15.0
   or later, 2FA enabled on the npm account, and publish access to every
   package):

   ```
   node .github/scripts/configure-trusted-publishers.mts --dry-run  # preview
   node .github/scripts/configure-trusted-publishers.mts             # apply
   ```

   It runs `npm trust github <package> --repo cedarjs/cedar --file publish.yml --allow-publish --yes` for each package, leaving the environment blank (only the `release` job uses one). A single package can also be configured by hand with `npm trust`, or through npmjs.com's per-package Settings → Publishing access → Trusted publisher UI.

   This comes first because the `release-candidate` and `release` jobs use
   OIDC only. A push to a `release/**` branch before the trusted publishers
   exist fails to publish.

2. Merge the `publish.yml` change. Canaries keep publishing with
   `NPM_AUTH_TOKEN` exactly as before.
3. Run the `release` job manually with `dry-run: true` (Actions → 🚢 Publish →
   Run workflow). The `tag` input accepts any ref for a dry run, so a release
   branch can be checked before it is tagged. `npm publish --dry-run` packs
   every package and still performs the OIDC token exchange for each one, so a
   green dry run proves the trusted publisher config for every package. The
   job never receives `NPM_AUTH_TOKEN`, so it cannot silently fall back to it.
4. Release. The push of the `release/**` branch publishes the RC with OIDC, and
   the tag push publishes the release.
5. Optionally, per package on npmjs.com: "Require two-factor authentication and
   disallow tokens" so the trusted publisher is the only way to publish. Not
   before canaries have stopped needing the token.
6. Configure the `npm-release` environment in the repo settings (required
   reviewers) if a human approval step is wanted before a stable release is
   published. GitHub creates the environment on the first run that references
   it.

## Things to remember

- Trusted publishing cannot create packages. A brand-new workspace needs a first
  manual publish (with a token) and its own trusted publisher config before it
  can be part of a release. `publish-release.mts` checks for this before
  publishing anything.
- The `release` job runs when a `vX.Y.Z` tag is pushed, from the workflow file
  at the tagged commit. A release from an older track (a v5 patch, say) needs
  `publish.yml` and `.github/scripts/publish-release.mts` on that branch
  before tagging. The tagged commit must already have versions bumped and the
  create-cedar-app templates updated (the release tooling does this); the
  script verifies it and refuses otherwise.
- Only GitHub-hosted runners are supported.
- The release tooling identifies CI runs by workflow name. With the
  consolidation it has to look at the job (`🏎 Publish Release Candidate`) inside
  the `🚢 Publish` workflow instead of a workflow with that name.
