# Plan: Unify version bumping into a single script

## Goal

Extract `tasks/update-package-versions.cjs` into **the single source of truth**
for bumping package versions across the entire monorepo. CI publish scripts and
the release-tooling should all call this script instead of duplicating the logic
inline.

## Current state — three different ways to bump versions

### 1. `tasks/update-package-versions.cjs`

What it covers:

- All workspace packages: version, `workspace:*`, and `@cedarjs/*` deps
- Templates: `ts` and `js` (root + api + web)
- Fixtures: `test-project` (root + api + web)

What it misses:

- Templates: `esm-ts`, `esm-js`
- Fixtures: `test-project-esm`, `test-project-live`
- Template overlays (6 directories under `templates/overlays/`)
- Database overlays (2 directories under `database-overlays/`)
- Peer deps in `api-server`, `storybook`, `storybook-vite`

### 2. `.github/scripts/publish_canary.sh`

Does everything inline with `jq`. Covers:

- All workspace packages: version + `workspace:*` deps
- All templates/overlays via `find` (covers what `update-package-versions.cjs`
  misses)
- Templates/overlays: only `@cedarjs/*` deps (not version field, not
  `workspace:*`)

Misses:

- `@cedarjs/*` deps in workspace packages themselves
- Fixtures
- Peer deps

### 3. `.github/scripts/publish-release-candidate.mts`

Does everything inline with Node.js. Covers:

- All workspace packages: version
- All workspace packages: `workspace:*` + `@cedarjs/*` deps (regex replace)
- Select template package.json files: `@cedarjs/*` deps

Misses:

- Fixtures
- Peer deps

### 4. `release-tooling/release/lib/release_functions.ts` (`updatePackageVersions()`)

Does everything inline with `fs.readJson`/`fs.writeJson`. Covers:

- All workspace packages: version + `workspace:*` + `@cedarjs/*` deps
- Peer deps: `api-server`, `storybook`, `storybook-vite`
- All templates: `ts`, `js`, `esm-ts`, `esm-js` (root + api + web)
- All fixtures: `test-project`, `test-project-esm` (root + api + web)
- All template overlays (6 directories)
- All database overlays (2 directories)

**This is the most comprehensive implementation.**

## What the unified script must cover

The script (`tasks/update-package-versions.cjs`) should handle:

1. **All workspace packages** — set version, replace `workspace:*` and
   `@cedarjs/*` in dependencies + devDependencies
2. **Peer dependencies** — `api-server`, `storybook`, `storybook-vite` have
   `@cedarjs/*` peer deps that need updating
3. **Templates** — `ts`, `js`, `esm-ts`, `esm-js` — each has `package.json` +
   `api/package.json` + `web/package.json`
4. **Fixtures** — `test-project`, `test-project-esm`, `test-project-live` — same
   structure as templates
5. **Template overlays** (6 directories):
   - `templates/overlays/esm/pnpm`
   - `templates/overlays/esm/yarn`
   - `templates/overlays/esm/npm`
   - `templates/overlays/cjs/pnpm`
   - `templates/overlays/cjs/yarn`
   - `templates/overlays/cjs/npm`
6. **Database overlays** (2 directories):
   - `database-overlays/pglite` — only `api/package.json`
   - `database-overlays/neon-postgres` — only `api/package.json`

The script should **only mutate files** — it should not run `yarn install`,
`git add`, or `git commit`. Callers handle those steps as needed.

## Steps

### Step 1 — Expand `tasks/update-package-versions.cjs`

Add the missing paths (esm-ts, esm-js templates; `test-project-esm` and
`test-project-live` fixtures; all template overlays; all database overlays; peer
deps) so it covers everything listed above.

Accept a version argument (already does). Strip optional `v` prefix (already
does).

### Step 2 — Update `publish_canary.sh`

Replace the three inline update blocks (version, workspace deps, template deps)
with a single call:

```bash
node tasks/update-package-versions.cjs "$CANARY_VERSION"
```

Keep the version calculation, NPM auth check, and publish loop as-is.

### Step 3 — Update `publish-release-candidate.mts`

Replace the inline version update + `updateWorkspaceDependencies()` call +
selective template updates with:

```ts
execCommand(`node tasks/update-package-versions.cjs ${versionToPublish}`)
```

Remove `updateWorkspaceDependencies()` and the dead
`updatePackageJsonWithVersion()` calls it replaces.

### Step 4 — Update release-tooling

In `release/lib/release_functions.ts`:`updatePackageVersions()`, replace the
inline loop + all `updateCedarDependencyVersions()` calls with:

```ts
await $`node tasks/update-package-versions.cjs ${version}`
```

Then keep only: `yarn install`, `yarn dedupe`, `git add .`, and `git commit`.

The `updateCedarDependencyVersions()` helper can also be removed since nothing
else calls it.

### Step 5 — Verify

- Run `tasks/update-package-versions.cjs 5.0.0` and confirm all package.json
  files are updated correctly (workspace packages, templates, fixtures,
  overlays, peer deps).
- Trigger a canary publish on next to verify the CI script works.
- Run the release-tooling through a dry-run to verify it works.
