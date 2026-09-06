# Canary releases on pkg.pr.new

Plan for moving `canary` (pushes to `main`) and `next` (pushes to `next`)
prereleases off npm and onto
[pkg.pr.new](https://github.com/stackblitz-labs/pkg.pr.new). Release candidates
and stable releases stay on npm; that side is covered by
[`trusted-publishing.md`](./trusted-publishing.md).

The change is driven by two things that turned out to be the same problem:

- A canary publish of ~70 packages sometimes fails halfway. Anyone who upgrades
  to canary in that window gets a project with half its `@cedarjs/*` packages on
  the new version and half on the old one.
- The fix for that on npm is to publish under a staging dist-tag and flip every
  package to `canary` once all of them exist. Flipping needs `npm dist-tag`, and
  npm's trusted publishing (OIDC) does not cover `dist-tag`
  ([npm/cli#8547](https://github.com/npm/cli/issues/8547)). The token-based way
  to do it is a bypass-2FA granular token, which npm caps at 90 days today and
  is scheduled to lose its remaining publish surface around January 2027. So the
  atomic-flip design has no long-term credential to run on.

pkg.pr.new needs no npm credentials at all, and its "latest for branch X"
pointer is updated only after every package in a run has been stored, which is
exactly the atomicity the staging flip was built to get.

## Background: how canaries work today

`publish.yml` (job `prerelease`) runs on every push to `main` and `next`, after
lint and tests. `.github/scripts/publish-prerelease.mts`:

1. Computes a version from the latest `vX.Y.Z` git tag and the number of commits
   since it: `7.0.0-canary.312` on `main`, `6.0.1-next.4` on `next`.
2. Writes that version into every workspace `package.json`, rewrites in-repo
   dependencies to it, and pins the `@cedarjs/*` deps in the `create-cedar-app`
   templates to it.
3. Publishes every public workspace under a staging dist-tag, then flips each
   package's `canary`/`next` dist-tag to the new version, then removes the
   staging tag. A nightly job sweeps staging tags left behind by failed runs.
4. Comments on the merged PR with `yarn cedar upgrade -t <version>`.

On the consumer side, everything keys off the npm `canary` dist-tag of
`@cedarjs/core`:

- `yarn cedar upgrade -t canary` resolves `@cedarjs/core@canary` with
  `latest-version`, then writes that exact version into every `@cedarjs/*`
  dependency in the root, `api/` and `web/` `package.json` files
  (`packages/cli/src/commands/upgrade/upgradeHandler.ts`). Because it pins one
  version everywhere, a half-published canary fails loudly at install time
  rather than producing a mixed project. Mixed projects come from anything that
  resolves the `canary` tag per package, such as `yarn up '@cedarjs/*@canary'`,
  or from a run that published `@cedarjs/core` before the packages that were
  missing.
- Two canary-only upgrade tasks, "Updating other packages in your
  package.json(s)" and "Downloading yarn patches", are enabled by checking
  whether the resolved version string contains `canary`.
- `preUpgradeScripts.ts` parses the resolved version and, for a `canary`
  prerelease, runs `upgrade-scripts/canary.ts` from `main`.
- `packages/cli/src/lib/packages.ts`, `setup/auth/auth.ts` and
  `setup/docker/dockerHandler.ts` install sibling `@cedarjs/*` packages at
  runtime at the CLI's own version, falling back to the `canary` tag when that
  version is not on npm.
- `packages/cli/src/lib/updateCheck.ts` resolves every tag in
  `notifications.versionUpdates` (which may include `canary`) against npm.
- `.github/actions/set-up-test-project` and `tasks/test-project` can upgrade a
  freshly generated project to canary with `yarn cedar upgrade -t canary`.
- `create-cedar-rsc-app` reads the `canary` dist-tag directly.

## What pkg.pr.new provides (verified against the source, September 2026)

- Publishing runs inside a GitHub Actions job with the pkg.pr.new GitHub App
  installed on the repo. The app records each workflow run; the CLI's single
  `/publish` call is accepted only for a run the app has seen. No npm token, no
  OIDC.
- One `pkg-pr-new publish <dir> <dir> ...` call packs every directory with
  `npm pack` and uploads all tarballs in one multipart request. The payload
  limit is 120 MB without whitelisting; Cedar's packed tarballs total about 2.3
  MB.
- Server side, package objects are written under `owner:repo:<sha>:<name>`, and
  the branch cursor `owner:repo:<branch>` is set to `<sha>` only after all of
  them are stored. The cursor never moves to an older workflow run. URLs of the
  form `https://pkg.pr.new/cedarjs/cedar/@cedarjs/core@main` resolve through the
  cursor; `@<sha>` and `@<pr-number>` forms resolve directly. A trailing `.tgz`
  is accepted and ignored.
- Dependencies between packages in the same publish (`dependencies`,
  `devDependencies`, `optionalDependencies`) are rewritten to the pkg.pr.new URL
  for the same commit before packing, then restored. `--peerDeps` rewrites
  `peerDependencies` to the sibling's version. Rewriting only happens when
  source directories are passed; prebuilt tarballs are uploaded as-is.
- Package versions are kept as found in `package.json` unless `--previewVersion`
  is used (which rewrites them to `0.0.0-preview-<sha>`).
- Yarn 4 installs these URLs with the descriptor form
  `yarn add @cedarjs/core@https://pkg.pr.new/cedarjs/cedar/@cedarjs/core@<sha>`.
  Yarn requires the package name in the descriptor for URL specs.
- `GET https://pkg.pr.new/api/repo/commits?owner=cedarjs&repo=cedar` lists
  releases newest-first with the default-branch pin on top (`pinnedSha`), each
  with its commit message, branch name and per-package install URLs.
- Retention: a release is deleted when it is older than six months, or has not
  been downloaded for a month. pkg.pr.new is explicitly not a registry.
- The service is run by StackBlitz with Cloudflare providing storage and is used
  by Vite, Vitest, TanStack, Biome, Clerk, Supabase and others.

## Decisions

### Keep semver canary versions in the packages

The publish script keeps computing `7.0.0-canary.312` and writing it into every
`package.json` before packing. `--previewVersion` is not used. Reasons:

- `cedar --version`, telemetry, and the "upgraded to CedarJS X" message keep
  showing a meaningful version.
- `7.0.0-canary.312` can never collide with an npm release, so the lockfile
  concern that `--previewVersion` exists for does not apply.
- Peer dependency ranges written by `--peerDeps` are satisfied by the installed
  tarball's version.

In-repo dependency specs are left as `workspace:*` and rewritten by pkg-pr-new
to same-commit URLs. The script's own `updateWorkspaceDependencies` step is not
needed for canaries.

### Long-form URLs everywhere

Compact URLs (`https://pkg.pr.new/@cedarjs/core@<sha>`) depend on npm metadata
lookups and fall back silently. Every URL Cedar writes, in the
`create-cedar-app` templates and in the upgrade command, uses the long form
`https://pkg.pr.new/cedarjs/cedar/<package>@<full-sha>`. The publish call uses
`--no-compact`.

### The consumer pins a commit, never a branch

`yarn cedar upgrade -t canary` resolves `main`'s pinned commit and writes
`@<sha>` URLs. It never writes `@main`: a `@main` URL would be cached by the
package manager under an unchanging key, so a later upgrade would not refetch.

### Sibling installs derive their spec from `@cedarjs/core`

Every place that installs an `@cedarjs/*` package at runtime goes through one
helper that looks at how `@cedarjs/core` is specified in the project's root
`package.json`. A pkg.pr.new URL yields the same-commit URL for the sibling; a
version yields that version. This replaces the per-command "is this version on
npm, else `canary`" logic in `packages.ts`, `auth.ts` and `dockerHandler.ts`.

### The upgrade command switches on the tag, not the version string

Canary-only behaviour (`Updating other packages in your package.json(s)`,
`Downloading yarn patches`, `upgrade-scripts/canary.ts`) is enabled by
`tag === 'canary'`, not by inspecting the resolved version. The resolved
identity of a canary is a commit sha, and nothing should parse a URL to find the
word "canary" in it.

### `next` follows the same path

`next` prereleases are published from the `next` branch by the same job and
resolved from the `next` branch cursor. Their pre-upgrade scripts keep the
release-branch semantics they have today (`6.x.ts` etc.), which needs the semver
version; see "Open questions".

## Target design

### CI

`publish.yml` loses the `prerelease` and `cleanup-staging-tags` jobs. A new
workflow, `.github/workflows/canary.yml`, runs on push to `main` and `next`:

```yaml
on:
  push:
    branches: [main, next]
    paths-ignore: ['docs/**']
permissions:
  contents: read
  pull-requests: write # for the merged-PR comment
jobs:
  canary:
    if: github.repository == 'cedarjs/cedar'
    runs-on: ubuntu-latest
    steps:
      - checkout (fetch-depth: 0, for the version calculation)
      - set-up-job
      - yarn lint
      - yarn test
      - node .github/scripts/publish-canary.mts
      - comment on the merged PR
```

`.github/scripts/publish-canary.mts` (replacing `publish-prerelease.mts`):

1. Compute the version exactly as today from git tags and commit count.
2. Write the version into every workspace `package.json`.
3. Rewrite the `@cedarjs/*` deps in `packages/create-cedar-app/templates/**` and
   `database-overlays/**` to
   `https://pkg.pr.new/cedarjs/cedar/<name>@${GITHUB_SHA}`.
4. Collect the directories of all non-private workspaces from
   `yarn workspaces list --json` and run, from the root lockfile:

   ```
   yarn pkg-pr-new publish --no-compact --no-template --comment=off --peerDeps <dirs...>
   ```

   `pkg-pr-new` becomes a root `devDependency` so it runs from the lockfile (the
   README warns against `npx`/`dlx` in CI). Renovate keeps it current.

5. Verify: `HEAD` each package's long URL at `GITHUB_SHA` and fail the job if
   any is missing. This should never trigger, since the upload is a single
   request, but it turns a silent service-side problem into a red job.
6. Comment on the merged PR with:

   ```
   yarn cedar upgrade -t canary        # latest main
   yarn cedar upgrade -t <sha>         # exactly this commit
   ```

The `--comment=off` flag is deliberate: pkg.pr.new's own comments target pull
requests, and this workflow runs on branch pushes. Whether to also publish on
`pull_request` is an open question below.

Concurrency: `cancel-in-progress` for pushes to the same branch is safe. A
cancelled run leaves no cursor change, and the server refuses to move a cursor
to an older run.

### CLI

**New module `packages/cli/src/lib/previewReleases.ts`:**

- `PKG_PR_NEW_BASE = 'https://pkg.pr.new/cedarjs/cedar'`.
- `isPreviewUrl(spec)` / `parsePreviewUrl(spec)` → `{ packageName, sha }`.
- `previewUrl(packageName, sha)`.
- `resolvePreviewRelease(ref: 'canary' | 'next' | sha)` → `{ sha }`:
  - `canary`: `pinnedSha` from
    `GET /api/repo/commits?owner=cedarjs&repo=cedar&per_page=1`.
  - `next`: newest row in the same listing whose `branch` is `next`, paging as
    needed.
  - sha (7 to 40 hex chars): `HEAD` the `@cedarjs/core` URL; 404 means "no
    canary was published for that commit" and is reported as such.
- `getCedarPackageSpec(packageName)`: the sibling-install helper described under
  Decisions.

**`upgrade`:**

- `tags.ts` accepts a git sha in addition to the named tags and semver.
- `setLatestVersionToContext` resolves `canary`, `next` and shas through
  `resolvePreviewRelease`; `latest`, `rc`, `experimental` and semver stay on
  `latest-version`.
- `updatePackageJsonVersion` writes `previewUrl(depName, sha)` when the target
  is a preview release, and the version otherwise.
- The three canary-only tasks are enabled by tag.
- The final message shows the version read from
  `node_modules/@cedarjs/core/package.json` after install, plus the short sha
  for preview releases.

**`preUpgradeScripts.ts`:** takes the tag as an explicit argument. `canary` →
`canary.ts`; `next` → see "Open questions"; everything else parses the version
as today.

**Sibling installs:** `packages.ts`, `setup/auth/auth.ts`,
`setup/docker/dockerHandler.ts` call `getCedarPackageSpec`.

**`updateCheck.ts`:** unchanged in behaviour for projects on npm versions. For a
project on a preview URL, `getLocalVersion` already returns `undefined` (the
spec is not valid semver) and the check is skipped. `canary` and `next` entries
in `notifications.versionUpdates` are ignored with a log line, since the npm
tags they would resolve stop advancing after the switch.

### create-cedar-app

Templates published in a canary build carry pkg.pr.new URLs, so

```
npx https://pkg.pr.new/cedarjs/cedar/create-cedar-app@<sha> my-app
npx https://pkg.pr.new/cedarjs/cedar/create-cedar-app@main my-app
```

creates a project pinned to that canary with no follow-up upgrade. The
`create-cedar-app` README section that says a canary CCA still installs stable
packages is rewritten around this.

## Implementation steps

The order matters because an installed CLI is what resolves "canary", and the
CLI people have installed today only knows how to ask npm.

### Phase 1 — CLI support, shipped through the existing npm canary

1. Add `previewReleases.ts` and wire up `upgrade`, `preUpgradeScripts`, the
   sibling-install helper and `updateCheck` as described. Unit tests for URL
   parsing, resolution (mocked fetch) and the `package.json` rewrite.
2. Land it on `main`. It goes out as an npm canary through the current pipeline.
   Also backport to the v6 patch line via `next` so that projects on a stable
   CLI can run `yarn cedar upgrade -t canary` and land on pkg.pr.new directly.
3. Verify from a test project on that canary: `yarn cedar upgrade -t <sha>`
   against a commit published manually with the Phase 2 workflow (see below; the
   two phases overlap by design).

### Phase 2 — Publish to both, compare

1. Install the pkg.pr.new GitHub App on `cedarjs/cedar` (org admin action).
2. Add `pkg-pr-new` to root `devDependencies`, add `canary.yml` and
   `publish-canary.mts`. Both this and the npm `prerelease` job run on every
   push for a week or two.
3. Exercise the consumer paths against pkg.pr.new:
   - `yarn cedar upgrade -t canary` and `-t <sha>` in a fresh project;
   - `yarn cedar setup auth dbAuth` (sibling install) on that project;
   - `npx https://pkg.pr.new/cedarjs/cedar/create-cedar-app@main`;
   - `.github/actions/set-up-test-project` with `canary: true` on one of the
     smoke-test workflows.
4. Confirm a deliberately failed run (for example, kill the job during upload)
   leaves `@main` on the previous commit.

### Phase 3 — Switch

1. Remove the `prerelease` and `cleanup-staging-tags` jobs from `publish.yml`,
   delete `publish-prerelease.mts` and `cleanup-staging-tags.mts`. The `token`
   mode and `forDistTag` in `lib/npm-auth.mts` go with them: nothing writes
   dist-tags any more, and the RC and release jobs only need `npm publish`,
   which does the OIDC exchange itself.
2. The npm `canary` and `next` dist-tags freeze at their last versions. Those
   versions contain the Phase 1 resolver, so a project on an older canary CLI
   gets there in two steps: the first `yarn cedar upgrade -t canary` lands on
   the last npm canary, the second lands on pkg.pr.new. Document this in the
   release notes and in `cli-commands.md`.
3. Update docs: `docs/docs/cli-commands.md` (upgrade section: what canary is,
   the `-t <sha>` form, retention), `docs/docs/contributing-walkthrough.md`,
   `docs/docs/app-configuration-cedar-toml.md` (`versionUpdates` no longer
   accepts `canary`/`next`), `packages/create-cedar-app/README.md`.
4. `tasks/getPackagesVersionsForTag.mjs`: drop `canary` and `next` from the tag
   list.

### Phase 4 — Cleanup

1. In `release-tooling`: delete `scripts/cleanup_staging_tags.ts`, close the
   `tobbe-cleanup-staging-tags` branch and worktree, and remove any code that
   reads canary versions from npm.
2. One last manual sweep of leftover `staging-*` dist-tags on npm (the nightly
   job is gone by then).
3. `create-cedar-rsc-app/src/upgradeToLatestCanary.ts`: either move to
   `resolvePreviewRelease` or delete, depending on the state of the RSC app
   generator.
4. Update `trusted-publishing.md`: the section on why the prerelease and cleanup
   jobs use a token no longer applies.

## Open questions

- **Pre-upgrade scripts for `next`.** Today `6.0.1-next.4` is treated like an RC
  and runs `6.0.1.ts` / `6.0.x.ts` / `6.x.ts`. That needs the semver version
  before install, and the pkg.pr.new commits API does not expose it. Options:
  (a) fetch `packages/core/package.json` from the tarball (`@cedarjs/core` is a
  few KB; needs a small tar reader or a `tar` dependency in the CLI); (b) have
  the publish script include the version in the `create-cedar-app` template
  `package.json` and read it from GitHub raw content at the sha; (c) compute the
  version from the git tag plus commit count via the GitHub API. (b) is the
  least machinery. Decide before Phase 1.
- **Publish on pull requests too.** pkg.pr.new's main use case is per-PR
  installs with an automatic PR comment. It would let reviewers try a PR in a
  real project without a merge, and `yarn cedar upgrade -t <sha>` already covers
  installing it. Cost: a build plus ~70 `npm pack`s per PR push, and fork PRs
  would publish tarballs built from untrusted code under the `cedarjs/cedar`
  namespace. If enabled, restrict to same-repo PRs.
- **Retention.** Six months, or one month unused. A project left on a canary
  from spring will not install in autumn. That is arguably right for a canary,
  but it is a change from npm, where old canaries stay forever. Worth a line in
  the docs at minimum.
- **Registries and proxies.** Corporate setups that allowlist
  `registry.npmjs.org` cannot install from pkg.pr.new. Is a slow-cadence npm
  canary (weekly, manual) worth keeping for them? Leaning no until someone asks.
- **`experimental` tag.** Not published by any current job. Left as an npm tag
  in `tags.ts` for now.
- **Upstream: branch cursors in the API.** Resolving `next` by scanning rows for
  `branch === 'next'` works but is indirect. A small PR to pkg.pr.new exposing
  `owner:repo:<branch>` cursors in `/api/repo/commits` (or a
  `/api/repo/branch?owner&repo&name` endpoint) would make both `canary` and
  `next` a single lookup.

## Files affected

CI and scripts:

- `.github/workflows/canary.yml` (new)
- `.github/workflows/publish.yml` (remove `prerelease`, `cleanup-staging-tags`)
- `.github/scripts/publish-canary.mts` (new)
- `.github/scripts/publish-prerelease.mts`,
  `.github/scripts/cleanup-staging-tags.mts` (delete)
- `.github/scripts/lib/npm-auth.mts` (drop the token mode and `forDistTag`)
- `package.json` (root; add `pkg-pr-new` devDependency)
- `tasks/getPackagesVersionsForTag.mjs`

CLI:

- `packages/cli/src/lib/previewReleases.ts` (new, with tests)
- `packages/cli/src/commands/upgrade/tags.ts`
- `packages/cli/src/commands/upgrade/upgrade.ts` (help text)
- `packages/cli/src/commands/upgrade/upgradeHandler.ts`
- `packages/cli/src/commands/upgrade/preUpgradeScripts.ts`
- `packages/cli/src/lib/packages.ts`
- `packages/cli/src/commands/setup/auth/auth.ts`
- `packages/cli/src/commands/setup/docker/dockerHandler.ts`
- `packages/cli/src/lib/updateCheck.ts`
- `packages/create-cedar-rsc-app/src/upgradeToLatestCanary.ts`

Docs:

- `docs/docs/cli-commands.md`
- `docs/docs/contributing-walkthrough.md`
- `docs/docs/app-configuration-cedar-toml.md`
- `packages/create-cedar-app/README.md`
- `docs/implementation-plans/trusted-publishing.md`

Elsewhere:

- `release-tooling`: `scripts/cleanup_staging_tags.ts` and the
  `tobbe-cleanup-staging-tags` branch.

## What this does NOT cover

- Release candidates and stable releases. They stay on npm, published with
  trusted publishing. With canaries gone, the only reason for `npm dist-tag` in
  CI disappears, and the release job can publish directly in dependency order
  with `@cedarjs/core` and `create-cedar-app` last. That change belongs to
  `trusted-publishing.md` and PR #2587.
- Provenance for canaries. pkg.pr.new tarballs carry no attestation.
- `@cedarjs/studio` and anything else published outside this monorepo.
