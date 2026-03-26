# Plan: Package Manager Agnosticism for Cedar Apps (v3)

## Summary

Remove the hard dependency on yarn for Cedar Apps by introducing a package
manager abstraction in `@cedarjs/cli-helpers` and migrating the current
hardcoded `yarn` invocations across the codebase. Cedar Apps will support
**yarn, npm, and pnpm**.

Key decisions in this revision:

- Package manager is **detected from the environment** (not configured in
  `cedar.toml`)
- All abstraction functions call `getPackageManager()` internally — no `pm`
  argument
- Wrapper functions handle execution (not command builders) to simplify future
  execa replacement
- Yarn PnP is supported — all yarn commands go through `yarn <bin>` to ensure
  correct resolution regardless of linker mode
- `create-cedar-app` ships first so each subsequent slice can be tested by
  scaffolding a new app with the target PM
- Implementation uses thin vertical slices — each slice is an independently
  shippable PR

## Goals

- Support `yarn`, `npm`, and `pnpm` for Cedar Apps
- Eliminate hardcoded `yarn` execution in Cedar app tooling
- Centralize package-manager behavior in one reusable abstraction
- Auto-detect the project package manager from environment/lockfiles
- Keep migration risk low for existing yarn-based Cedar apps
- Support package-manager-specific scaffolding and Docker output where needed
- Support all yarn modes including PnP

## Non-Goals

- Supporting `create-cedar-rsc-app` in this effort
- Requiring explicit package-manager configuration in `cedar.toml`
- Preserving Yarn patch support
- Guaranteeing feature-equivalent implementations for every package-manager
  operation
- Running the full test matrix for all package managers on every PR

## Source of Truth

The project package manager is **detected automatically** from the environment.
There is no `packageManager` field in `cedar.toml`.

### Detection Order

`getPackageManager()` in `@cedarjs/project-config/packageManager` uses this
order:

1. **`npm_config_user_agent` environment variable** — parsed to identify the
   invoker's package manager (e.g. `yarn/4.13.0`, `pnpm/9.x`, `npm/10.x`)
2. **Lockfile presence** — checked in order: `yarn.lock` > `pnpm-lock.yaml` >
   `package-lock.json`
3. **Default fallback** — `'yarn'`

Results are cached for the process lifetime.

### Why Environment Detection Over Config

- Zero migration burden for existing apps (yarn apps keep working because
  `yarn.lock` exists)
- No config field to forget or misconfigure
- Matches user expectations: if they run `pnpm install`, Cedar detects pnpm
- Simpler than a two-layer system (config + fallback)

### No `cedar.toml` Config Field

The `packageManager` field is **not** added to `cedar.toml`, the config
interface, or the TOML schema. The environment is the sole source of truth.

## Existing App Migration

Existing Cedar apps only support yarn today. Because detection is based on
lockfiles and environment, **no explicit migration is needed**. Yarn apps have
`yarn.lock`, so they will continue to be detected as yarn projects automatically.

A separate codemod to write `packageManager = "yarn"` into `cedar.toml` is
**no longer required**.

## Architecture: Two-Layer Design

### Layer 1: `@cedarjs/project-config/packageManager` (low-level, already merged)

**Location:** `packages/project-config/src/packageManager.ts`

No heavy dependencies. Provides:

- `PackageManager` type (`'yarn' | 'npm' | 'pnpm'`)
- `getPackageManager()` — detection via env var + lockfiles
- `resetPackageManagerCache()` — for testing
- `prettyPrintCedarCommand(args)` — user-facing command strings

### Layer 2: `@cedarjs/cli-helpers/packageManager` (high-level, partially merged)

**Location:** `packages/cli-helpers/src/packageManager/`

Depends on project-config. Provides wrapper functions, task generators, and
display helpers. Everything here calls `getPackageManager()` internally — no
caller needs to pass `pm`.

### API Design Principle

All functions call `getPackageManager()` internally. No function takes `pm` as
a parameter. This keeps call sites simple and makes future execa replacement a
single-module change.

### Already Merged (in `cli-helpers/packageManager/index.ts`)

Current exports from `packages/cli-helpers/src/packageManager/index.ts`:

- `add()` — returns `'install'` for npm, `'add'` for yarn/pnpm
- `install()` — returns `'install'`
- `dedupe()` — returns `'dedupe'` for yarn, `undefined` for npm/pnpm
- `dedupeIsSupported()` — boolean
- `installationErrorMessage()` — user-facing error string
- `workspacePackageSpecifier()` — `'workspace:*'` vs `'*'`
- `prettyPrintCedarCommand(args)` — e.g. `"yarn cedar upgrade"`

These are thin string/verb helpers. They remain as-is and are used internally
by the execution wrappers and by `installHelpers.ts`.

## Modules to Add

### 1. `helpers.ts` — Execution Wrappers

All functions internally call `getPackageManager()`. No `pm` argument.

Core execution function:

```ts
async function runPackageManagerCommand(
  command: string,
  args: string[],
  options?: ExecaOptions
)
```

Ad-hoc execution wrappers:

```ts
// Run a script defined in package.json "scripts"
async function runScript(
  script: string,
  args?: string[],
  options?: ExecaOptions
)
async function runScriptSync(
  script: string,
  args?: string[],
  options?: ExecaOptions
)

// Run a script in a workspace
async function runWorkspaceScript(
  workspace: string,
  script: string,
  args?: string[],
  options?: ExecaOptions
)

// Run a local binary (from node_modules/.bin)
async function runBin(bin: string, args?: string[], options?: ExecaOptions)
async function runBinSync(bin: string, args?: string[], options?: ExecaOptions)

// Run a binary in a workspace context
async function runWorkspaceBin(
  workspace: string,
  bin: string,
  args?: string[],
  options?: ExecaOptions
)

// One-off package execution (yarn dlx / npx / pnpm dlx)
async function dlx(command: string, args?: string[], options?: ExecaOptions)

// Package operations
async function addRootPackages(
  packages: string[],
  options?: ExecaOptions & { dev?: boolean }
)
async function addWorkspacePackages(
  workspace: string,
  packages: string[],
  options?: ExecaOptions & { dev?: boolean }
)
async function removeWorkspacePackages(
  workspace: string,
  packages: string[],
  options?: ExecaOptions
)
async function installPackages(options?: ExecaOptions)
```

### 2. `tasks.ts` — Listr2 Task Generators

For Listr2 task return values. All internally call `getPackageManager()`.

```ts
function installPackagesTask(cwd?: string)
function addRootPackagesTask(packages: string[], dev?: boolean, cwd?: string)
function addWorkspacePackagesTask(
  workspace: string,
  packages: string[],
  dev?: boolean,
  cwd?: string
)
function removeWorkspacePackagesTask(
  workspace: string,
  packages: string[],
  cwd?: string
)
function runScriptTask(script: string, args?: string[], cwd?: string)
function runWorkspaceScriptTask(
  workspace: string,
  script: string,
  args?: string[],
  cwd?: string
)
```

Each returns `{ title: string, task: async () => { ... } }` following the
existing Listr2 convention.

### 3. `display.ts` — User-Facing Command Formatters

No execution. Returns formatted strings. All internally call
`getPackageManager()`.

```ts
function formatInstallCommand(): string
function formatCedarCommand(args: string[]): string
function formatRunScriptCommand(script: string, args?: string[]): string
function formatRunWorkspaceScriptCommand(
  workspace: string,
  script: string,
  args?: string[]
): string
function formatRunBinCommand(bin: string, args?: string[]): string
function formatRunWorkspaceBinCommand(
  workspace: string,
  bin: string,
  args?: string[]
): string
function formatDlxCommand(command: string, args?: string[]): string
function formatAddRootPackagesCommand(packages: string[], dev?: boolean): string
function formatAddWorkspacePackagesCommand(
  workspace: string,
  packages: string[],
  dev?: boolean
): string
function formatRemoveWorkspacePackagesCommand(
  workspace: string,
  packages: string[]
): string
```

### 4. `index.ts` — Barrel Export

Exports everything from existing verb helpers + new helpers, tasks, display,
and config.

### `installHelpers.ts` — Delegates to Package Manager Module

`packages/cli-helpers/src/lib/installHelpers.ts` becomes a thin wrapper around
the task generators from `tasks.ts`, applying `getPaths()` for cwd:

```ts
import {
  addWorkspacePackagesTask,
  addRootPackagesTask,
  installPackagesTask,
} from '../packageManager/index.js'
import { getPaths } from './paths.js'

export const addWebPackages = (packages: string[]) =>
  addWorkspacePackagesTask('web', packages, false, getPaths().web.base)

export const addApiPackages = (packages: string[]) =>
  addWorkspacePackagesTask('api', packages, false, getPaths().api.base)

export const addRootPackages = (packages: string[], dev = false) =>
  addRootPackagesTask(packages, dev, getPaths().base)

export const installPackages = installPackagesTask(getPaths().base)
```

## Command Semantics

### Yarn PnP Compatibility

All Yarn commands go through `yarn <bin>` to ensure correct resolution
regardless of whether the project uses `nodeLinker: node-modules` or PnP. There
is no PnP detection — the abstraction treats all Yarn projects the same.

### Install dependencies

- yarn: `yarn install`
- npm: `npm install`
- pnpm: `pnpm install`

### Add packages to root

- yarn: `yarn add [-D] ...`
- npm: `npm install [-D] ...`
- pnpm: `pnpm add [-D] ...`

### Add packages to workspace

- yarn: `yarn workspace <workspace> add [-D] ...`
- npm: `npm install [-D] ... -w <workspace>`
- pnpm: `pnpm add [-D] ... --filter <workspace>`

### Run script (package.json "scripts")

- yarn: `yarn <script> [args]`
- npm: `npm run <script> -- [args]`
- pnpm: `pnpm <script> [args]`

### Run workspace script

- yarn: `yarn workspace <workspace> <script> [args]`
- npm: `npm run <script> -w <workspace> -- [args]`
- pnpm: `pnpm <script> --filter <workspace> [args]`

### Run local binary (node_modules/.bin)

- yarn: `yarn <bin> [args]` (PnP-safe)
- npm: `npx <bin> [args]`
- pnpm: `pnpm exec <bin> [args]`

### Run workspace binary

- yarn: `yarn workspace <workspace> <bin> [args]`
- npm: `npm exec -w <workspace> -- <bin> [args]`
- pnpm: `pnpm exec --filter <workspace> <bin> [args]`

### One-off execution

- yarn: `yarn dlx <command> [args]`
- npm: `npx <command> [args]`
- pnpm: `pnpm dlx <command> [args]`

### Dedupe

- yarn: `yarn dedupe`
- npm: silently skip
- pnpm: silently skip

### Run Node.js

- yarn: `yarn node [args]` (PnP-safe)
- npm: `node [args]`
- pnpm: `pnpm node [args]`

## Execa Cleanup

Many existing execa call sites use unnecessary `shell: true` or
`execa.command(string)` patterns. During migration, these should be cleaned up
to use standard array-form execa calls. Only ~4 call sites genuinely need shell
mode (pipe operator, `&&` chaining, Windows spawn, quoted-path args).

## Concurrently Command Strings

Several CLI commands use `concurrently` to run multiple processes in parallel.
These pass command strings that currently hardcode `yarn`. Each `yarn <bin>`
in these strings must be replaced with its corresponding
`formatRunBinCommand()` call.

Example — `devHandler.ts`:

```js
// Before:
command: `yarn cross-env NODE_ENV=development rw-vite-dev ${forward}`
command: 'yarn nodemon'
command: `  --exec "yarn ${serverWatchCommand}`
command: 'yarn rw-gen-watch'

// After:
command: `${formatRunBinCommand('cross-env', ['NODE_ENV=development', 'rw-vite-dev', ...forward])}`
command: formatRunBinCommand('nodemon')
command: `  --exec "${formatRunBinCommand(serverWatchCommand)}`
command: formatRunBinCommand('rw-gen-watch')
```

## Config Template Files

Some setup handlers write configuration files that contain hardcoded `yarn`
references (e.g. `coherenceHandler.js` generates YAML with `yarn cedar`
commands, `baremetal.js` defaults `packageManagerCommand: 'yarn'`). These must
be updated to use the detected package manager when generating config content.

## Testing Strategy

### Unit tests for abstraction

Test command generation and display formatting in isolation. Use memfs for
filesystem operations. Already done for existing verb helpers; extend for new
helpers, tasks, and display functions.

### Existing tests

Many existing CLI tests assert `execa` was called with `'yarn'`. These must be
updated to assert the correct PM based on mocked `getPackageManager()` return
values.

### No broad per-PR cross-PM expansion

Do not run the full test suite for all PMs on every PR.

### Manual fixture generation

Add `--packageManager` flag to fixture rebuild scripts so test fixtures can be
generated for npm and pnpm when needed.

### Scheduled CI matrix

Run smoke tests across yarn/npm/pnpm on a scheduled workflow (daily +
workflow_dispatch).

### Manual verification checklist

For each slice: scaffold a new app with the target PM, run the migrated
commands, verify correct behavior.

---

## Implementation Order: Thin Vertical Slices

Each slice is an independently shippable PR. Every slice is testable by
scaffolding a new Cedar app (via create-cedar-app) with the target package
manager and running the commands covered by that slice.

Dependencies between slices are noted but each PR can be reviewed and merged
independently.

---

### Slice 1: create-cedar-app — Package Manager Selection

**PR adds:**

New functionality in `packages/create-cedar-app/`:

- `--package-manager` / `--pm` CLI flag (choices: `yarn`, `npm`, `pnpm`)
- `--install` flag (renamed from `--yarn-install`)
- Interactive PM selection prompt when flag not provided
- Default derived from `npm_config_user_agent`

Template changes — PM-specific files only, rest uses placeholders:

The existing structure is `templates/{ts,esm-ts,js,esm-js}/...`. Most files stay at
the language level with placeholder strings that get replaced at generation time.
Only `package.json` differs enough to warrant separate files:

```
templates/
├── ts/
│   ├── yarn/
│   │   └── package.json     # yarn-specific: resolutions, packageManager field
│   ├── npm/
│   │   └── package.json     # npm-specific: overrides, no packageManager field
│   ├── pnpm/
│   │   └── package.json     # pnpm-specific: pnpm.overrides, packageManager field
│   ├── .yarnrc.yml          # shared, no placeholders needed (Yarn-only)
│   ├── cedar.toml           # shared, no yarn refs
│   ├── README.md            # shared, uses placeholders like {{PM}} install
│   ├── .vscode/
│   │   └── launch.json     # shared, uses placeholders like {{PM}} cedar dev
│   ├── scripts/
│   │   └── seed.ts         # shared, uses placeholders like {{PM}} cedar prisma
│   └── ... (base files: web/, api/, src/, vite.config.ts, etc.)
├── esm-ts/
│   ├── yarn/
│   │   └── package.json
│   ├── npm/
│   │   └── package.json
│   └── pnpm/
│       └── package.json
├── js/
│   ├── yarn/
│   │   └── package.json
│   ├── npm/
│   │   └── package.json
│   └── pnpm/
│       └── package.json
└── esm-js/
    ├── yarn/
    │   └── package.json
    ├── npm/
    │   └── package.json
    └── pnpm/
        └── package.json
```

**Why nested (not lifted up)?** Keeping `yarn/`, `npm/`, `pnpm/` under each
language folder adds some duplication (12 package.json files total), but the
generation logic stays simple — just copy files. Lifting PM folders up would
require merge logic (combining base deps + PM-specific fields) for marginal
gain.

Placeholder strategy for shared files:

- `{{PM}}` → `yarn` | `npm` | `pnpm`
- `{{PM_INSTALL}}` → `yarn install` | `npm install` | `pnpm install`
- `{{CEDAR_CLI}}` → `yarn cedar` | `npx cedar` | `pnpm exec cedar`

This minimizes duplication: only `package.json` is truly different per PM. All
other files use the same template with placeholder substitution.

Generation flow in `create-cedar-app.js`:

1. Copy all files from `templates/{language}/` (base files)
2. Copy PM-specific directory (`templates/{language}/yarn/`,
   `templates/{language}/npm/`, or `templates/{language}/pnpm/`)
3. No file transformation needed — templates already contain correct content

Rename all `yarn` references in messages/prompts/telemetry to PM-aware
strings.

**Shippable value:** `create-cedar-app --pm npm` scaffolds a working Cedar
project configured for npm. All subsequent slices can be tested by scaffolding
with the target PM.

**Testing:** Manually run `create-cedar-app --pm npm`, `--pm pnpm`, `--pm yarn`
and verify the generated project has correct files, package.json fields, and
install commands.

---

### Slice 2: Core Abstraction + Build + Lint

**PR adds:**

New files in `packages/cli-helpers/src/packageManager/`:

- `helpers.ts` — execution wrappers: `runPackageManagerCommand`, `runScript`,
  `runScriptSync`, `runWorkspaceScript`, `runBin`, `runBinSync`,
  `runWorkspaceBin`, `dlx`, `addRootPackages`, `addWorkspacePackages`,
  `removeWorkspacePackages`, `installPackages`
- `tasks.ts` — Listr2 task generators: `installPackagesTask`,
  `addRootPackagesTask`, `addWorkspacePackagesTask`,
  `removeWorkspacePackagesTask`, `runScriptTask`, `runWorkspaceScriptTask`
- `display.ts` — formatters: `formatCedarCommand`, `formatInstallCommand`,
  `formatRunScriptCommand`, `formatRunWorkspaceScriptCommand`,
  `formatRunBinCommand`, `formatRunWorkspaceBinCommand`, `formatDlxCommand`,
  `formatAddRootPackagesCommand`, `formatAddWorkspacePackagesCommand`,
  `formatRemoveWorkspacePackagesCommand`
- Updated `index.ts` barrel export
- Unit tests for all new helpers, tasks, and display functions

Updated file:

- `packages/cli-helpers/src/lib/installHelpers.ts` — delegates to task
  generators from `tasks.ts` instead of inline execa calls

**PR migrates:**

- `packages/cli/src/commands/build/buildHandler.ts` — display strings →
  `formatCedarCommand`, `formatRunWorkspaceScriptCommand`; remove unnecessary
  `shell: true` on prerender call → `runScript('cedar', ['prerender'], opts)`
- `packages/cli/src/commands/build/buildPackagesTask.js` —
  `execa('yarn', ['build'])` → `runScript('build', [], { cwd })`
- `packages/cli/src/commands/build/prerenderHandler.ts` — display strings →
  `formatCedarCommand`
- `packages/cli/src/commands/lint.ts` — `execa('yarn', filteredArgs)` →
  `runBin('eslint', args, { cwd })`

**PR updates tests:**

- `packages/cli/src/commands/build/__tests__/buildPackagesTask.test.js` —
  update assertions from `'yarn'` to mocked PM value

**Shippable value:** `cedar build` and `cedar lint` work with detected PM.

**Depends on:** Slice 1 (to test with npm/pnpm scaffolded project)

---

### Slice 3: Test + Type-check + Serve

**PR migrates:**

- `packages/cli/src/commands/test/testHandler.ts` —
  `execa('yarn', ['jest', ...])` → `runScript('jest', args, { cwd })`
- `packages/cli/src/commands/test/testHandlerEsm.ts` —
  `execa('yarn', ['vitest', ...])` → `runScript('vitest', args, { cwd })`
- `packages/cli/src/commands/type-checkHandler.ts` —
  `execa('yarn rw-gen', { shell: true })` → `runBin('rw-gen')` without
  `shell: true`; concurrently string `'yarn tsc ...'` →
  `formatRunBinCommand('tsc', ['--noEmit', '--skipLibCheck'])`
- `packages/cli/src/commands/serveWebHandler.ts` —
  `execa('yarn', ['rw-serve-fe'])` → `runBin('rw-serve-fe', [], { cwd })`
- `packages/cli/src/commands/serveApiHandler.ts` —
  `execa('yarn', filteredArgs)` → `runBin(cmd, args, { cwd })`
- `packages/cli/src/commands/serveBothHandler.ts` — execa calls →
  `runBin('rw-serve-fe', ...)`, `runScript('cedar', ['dev', 'api', ...])`;
  concurrently strings: `'yarn node ...'` →
  `${formatRunBinCommand('node', [...])} ...`, `'yarn rw-web-server ...'` →
  `formatRunBinCommand('rw-web-server', args)`

**PR updates tests:**

- `packages/cli/src/commands/test/__tests__/test.test.ts` — update assertions
- `packages/cli/src/commands/test/__tests__/testEsm.test.js` — update
  assertions
- `packages/cli/src/commands/__tests__/type-check.test.ts` — update assertions

**Shippable value:** `cedar test`, `cedar type-check`, and all serve modes work
with detected PM.

**Depends on:** Slice 2

---

### Slice 4: Dev Command

**PR migrates:**

- `packages/cli/src/commands/dev/devHandler.ts` — concurrently command strings:
  - `'yarn cross-env NODE_ENV=development rw-vite-dev ${forward}'` →
    `` `${formatRunBinCommand('cross-env', ['NODE_ENV=development', 'rw-vite-dev', ...forward])}` ``
  - `'yarn cross-env NODE_ENV=development rw-dev-fe ${forward}'` →
    `` `${formatRunBinCommand('cross-env', ['NODE_ENV=development', 'rw-dev-fe', ...forward])}` ``
  - `'yarn nodemon'` → `formatRunBinCommand('nodemon')`
  - `` `--exec "yarn ${serverWatchCommand}` `` →
    `` `--exec "${formatRunBinCommand(serverWatchCommand)}` ``
  - `'yarn rw-gen-watch'` → `formatRunBinCommand('rw-gen-watch')`

**PR updates tests:**

- `packages/cli/src/commands/dev/__tests__/dev.test.ts` — update assertions
  for concurrently command strings

**Shippable value:** `cedar dev` works with detected PM. Single file but
non-trivial concurrently string patterns warrant a dedicated PR for focused
review.

**Depends on:** Slice 3

---

### Slice 5: Generate

**PR migrates:**

- `packages/cli/src/commands/generate.ts` —
  `execa.sync('yarn', ['rw-gen'])` → `runBinSync('rw-gen', [], { stdio: 'inherit' })`
- `packages/cli/src/commands/generate/scaffold/scaffoldHandler.js` —
  workspace add/remove → `addWorkspacePackages`, `removeWorkspacePackages`
- `packages/cli/src/commands/generate/package/packageHandler.js` —
  `execa('yarn', ['install'])` → `installPackages`;
  `execa('yarn', ['build'])` → `runScript('build')`;
  `execa.sync('yarn', ['eslint', ...])` → `runBinSync('eslint', ...)`
- `packages/cli/src/commands/generate/cell/cellHandler.js` — display string →
  `formatCedarCommand`
- `packages/cli/src/commands/generate/dataMigration/dataMigration.js` —
  display string → `formatCedarCommand`
- `packages/cli/src/commands/generate/dbAuth/dbAuthHandler.js` — display
  strings → `formatCedarCommand`;
  `execa.commandSync('yarn cedar g types')` →
  `runBinSync('cedar', ['g', 'types'])`
- `packages/cli/src/commands/generate/directive/directiveHandler.js` —
  `execa('yarn', ['rw-gen'])` → `runBin('rw-gen', [], { stdio })`
- `packages/cli/src/commands/generate/job/jobHandler.js` —
  `execa.sync('yarn', [...])` → `runBinSync(...)`

**PR updates tests:**

- `packages/cli/src/commands/generate/package/__tests__/package.test.ts` —
  update assertions

**Shippable value:** All `cedar generate` commands work with detected PM.

**Depends on:** Slice 2

---

### Slice 6: Deploy + lib/index.js

**PR migrates:**

- `packages/cli/src/lib/index.js` — `addPackagesTask` updated to build
  PM-aware commands internally (using `addWorkspacePackages`/`addRootPackages`
  verb helpers from merged code); `runCommandTask` stays generic
- `packages/cli/src/commands/deploy/serverlessHandler.js` — all
  `execa('yarn', ...)` and `execa('yarn serverless ...')` →
  `runBin('serverless', ...)`, `runScript('cedar', ...)`; display strings →
  `formatCedarCommand`, `formatRunBinCommand`; remove `shell: true`
- `packages/cli/src/commands/deploy/baremetal/baremetalHandler.js` — display
  strings → `formatCedarCommand`
- `packages/cli/src/commands/deploy/renderHandler.js` —
  `execa.commandSync('yarn cedar ...')` → `runScriptSync('cedar', ...)`;
  `execa('yarn node ...')` → `runBin('node', ...)`;
  `execa.commandSync('yarn install')` → `installPackages`
- `packages/cli/src/commands/deploy/flightcontrolHandler.ts` —
  `execa('yarn node ...')` → `runBin('node', ...)`;
  `execa.command(command)` where command starts with `yarn cedar` →
  `runScript('cedar', args)`

**Shippable value:** All deploy modes work with detected PM. The shared
`addPackagesTask` utility is PM-aware.

**Depends on:** Slice 2

---

### Slice 7: Setup + Experimental + lib/packages.js

**PR migrates:**

- `packages/cli/src/lib/packages.js` —
  `execa.command('yarn add -D ...')` → `addRootPackages([pkg], { dev: true })`;
  `execa.command('yarn dedupe')` → dedupe via `runPackageManagerCommand`
- `packages/cli/src/commands/setup/package/packageHandler.js` —
  `execa('yarn', ['dlx', ...])` → `dlx(command, args)`
- `packages/cli/src/commands/setup/auth/auth.js` —
  `execa.command('yarn add -D ...')` → `addRootPackages`
- `packages/cli/src/commands/setup/docker/dockerHandler.js` —
  `execa.command('yarn plugin ...')` → `runBin('yarn', ['plugin', ...])`;
  workspace add → `addWorkspacePackages`; dedupe → dedupe abstraction
- `packages/cli/src/commands/setup/i18n/i18nHandler.js` — workspace add →
  `addWorkspacePackages`; run script → `runWorkspaceScript`
- `packages/cli/src/commands/setup/jobs/jobsHandler.js` — workspace add →
  `addWorkspacePackages`; run script → `runWorkspaceScript`
- `packages/cli/src/commands/setup/realtime/realtimeHandler.js` —
  `execa.sync('yarn', [...])` → `runBinSync`; workspace add →
  `addWorkspacePackages`
- `packages/cli/src/commands/setup/liveQueries/liveQueriesHandler.js` —
  workspace add → `addWorkspacePackages`
- `packages/cli/src/commands/setup/ui/libraries/chakra-uiHandler.js` —
  workspace add → `addWorkspacePackages`
- `packages/cli/src/commands/setup/ui/libraries/mantineHandler.js` —
  workspace add → `addWorkspacePackages`
- `packages/cli/src/commands/setup/ui/libraries/tailwindcssHandler.js` —
  root add → `addRootPackages`; workspace add → `addWorkspacePackages`;
  `execa('yarn', ['tailwindcss', 'init', ...])` →
  `runBin('tailwindcss', ['init', ...])`
- `packages/cli/src/commands/setup/ui/libraries/ogImageHandler.ts` —
  workspace add → `addWorkspacePackages`
- `packages/cli/src/commands/setup/uploads/uploadsHandler.js` —
  workspace add → `addWorkspacePackages`
- `packages/cli/src/commands/setup/deploy/providers/coherenceHandler.js` —
  hardcoded `yarn` strings in generated YAML config → PM-aware generation
  using `formatCedarCommand`
- `packages/cli/src/commands/setup/deploy/providers/serverlessHandler.js` —
  uses `addPackagesTask` (already migrated in Slice 6)
- `packages/cli/src/commands/setup/deploy/providers/baremetalHandler.js` —
  uses `addPackagesTask`
- `packages/cli/src/commands/setup/cache/cacheHandler.js` — uses
  `addPackagesTask`
- `packages/cli/src/commands/setup/deploy/templates/baremetal.js` —
  `packageManagerCommand = "yarn"` default → PM-aware via
  `getPackageManager()`
- `packages/cli/src/commands/experimental/setupInngestHandler.js` —
  root add → `addRootPackages`; run bin → `runBin`
- `packages/cli/src/commands/experimental/setupOpentelemetryHandler.js` —
  `execa('yarn cedar prisma generate')` → `runScript('cedar', ['prisma', 'generate'])`
- `packages/cli/src/commands/experimental/setupReactCompilerHandler.js` —
  root add → `addRootPackages`; workspace add → `addWorkspacePackages`
- `packages/cli/src/commands/experimental/setupRscHandler.js` —
  install → `installPackages`
- `packages/cli/src/commands/experimental/util.js` — display string →
  `formatCedarCommand`

**PR updates tests:**

- `packages/cli/src/commands/setup/package/__tests__/packageHandler.test.js`
- `packages/cli/src/commands/setup/ui/__tests__/tailwindcss.test.ts`

**Shippable value:** All `cedar setup` and `cedar experimental` commands work
with detected PM. This is the largest slice (~20 source files) but the changes
are highly mechanical.

**Depends on:** Slices 2, 6

---

### Slice 8: External Packages

**PR migrates:**

- `packages/vite/src/buildFeServer.ts` — display string →
  `formatCedarCommand`
- `packages/vite/src/devFeServer.ts` — display string →
  `formatCedarCommand` (if yarn references exist)
- `packages/vite/src/utils.ts` — display string → `formatCedarCommand`
  (if yarn references exist)
- `packages/vite/package.json` — add `@cedarjs/cli-helpers` dependency
- `packages/auth-providers/dbAuth/setup/src/shared.ts` — already partially
  migrated in a prior merge; verify completeness

**Shippable value:** Non-CLI packages display PM-aware messages and execute
commands with detected PM.

**Depends on:** Slice 2

---

### Slice 9: CI + Fixture Scripts + Cleanup

**PR adds:**

- `--packageManager` / `--pm` flag for
  `tasks/test-project/rebuild-test-project-fixture.mts`
- `--packageManager` / `--pm` flag for `tasks/rebuild-test-project.mts`
- `.github/workflows/package-manager-matrix.yml` — scheduled daily CI running
  smoke tests across yarn/npm/pnpm matrix; also triggerable via
  workflow_dispatch
- Parameterized `.github/actions/set-up-test-project/` to accept
  `packageManager` input

**PR removes:**

- `downloadYarnPatches()` from
  `packages/cli/src/commands/upgrade/upgradeHandler.ts`

**Shippable value:** CI validates all package managers on a schedule. Fixture
rebuild supports generating npm/pnpm test projects. Yarn patch support is
cleaned up.

**Depends on:** All previous slices (needs complete CLI migration to generate
meaningful test fixtures for npm/pnpm)

---

## Summary of Slices

| #   | Scope                                  | Files             | Shippable value                                 |
| --- | -------------------------------------- | ----------------- | ----------------------------------------------- |
| 1   | create-cedar-app PM selection          | ~5 + templates    | Scaffold apps with any PM                       |
| 2   | Core abstraction + Build + Lint        | 4 + 3 new modules | `cedar build`, `cedar lint`                     |
| 3   | Test + Type-check + Serve              | 6                 | `cedar test`, `cedar type-check`, `cedar serve` |
| 4   | Dev                                    | 1 + tests         | `cedar dev`                                     |
| 5   | Generate                               | 8 + tests         | All `cedar generate` commands                   |
| 6   | Deploy + lib/index.js                  | 5                 | All deploy modes                                |
| 7   | Setup + Experimental + lib/packages.js | ~20 + tests       | All `cedar setup` + `cedar experimental`        |
| 8   | External packages                      | ~4                | Non-CLI packages PM-aware                       |
| 9   | CI + fixtures + cleanup                | ~4 + workflow     | Automated PM matrix validation                  |

## Implementation Decisions

- Detection over config — no `cedar.toml` field
- No `pm` argument — all functions call `getPackageManager()` internally
- Wrapper functions (not command builders) for easier future execa replacement
- Yarn PnP compatible — all Yarn commands go through `yarn <bin>`
- create-cedar-app ships first to enable testing of subsequent slices
- Thin vertical slices — each PR is independently shippable and testable
- Execa cleanup happens incrementally during migration (remove unnecessary
  `shell: true`, convert `execa.command(string)` to `execa(cmd, args)`)
- Config template files (coherence, baremetal) generate PM-aware content
- Existing test assertions updated per-slice to match new behavior

## Implementation Notes

### Duplicated Templates Over Inline Logic

Favor duplicated template files and strings rather than one file/string with
complicated inline logic to make the content PM-specific. For example, if a
setup handler needs to write a config file with PM-specific commands, prefer
separate template strings per PM over a single template with conditionals.

**Exception for scaffolding templates:** Simple placeholder replacement (e.g.
`{{PM}}` → `yarn` | `npm` | `pnpm`) in template files is acceptable and
preferred over duplicating every file. Use a small set of well-defined
placeholders like `{{PM}}`, `{{PM_INSTALL}}`, `{{CEDAR_CLI}}`. Complicated
inline logic (conditionals, loops, regex) in templates should still be
avoided.

### Split Chained Commands

Some existing code uses `&&` to chain commands in a single execa invocation
(e.g. `'yarn cedar build api && yarn cedar serve api'`). Split these into
separate execa calls so each can use the standard wrappers being added.

### Test Writing Discipline

Write tests one at a time. For each test:

1. Write a single test
2. Run `yarn test` and confirm it passes
3. Confirm no TypeScript errors, lint errors, or formatting issues
4. Only then continue to the next test

Write as few tests as possible while still covering the critical path plus one
or two edge cases if needed.
