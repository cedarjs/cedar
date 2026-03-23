# Plan: Package Manager Agnosticism for Cedar Apps (Revised)

## Summary

Remove the hard dependency on yarn for Cedar Apps by introducing a package
manager abstraction in `@cedarjs/cli-helpers` and migrating the current
hardcoded `yarn` invocations across the codebase. Cedar Apps will support
**yarn, npm, and pnpm**.

This revised plan makes `cedar.toml` the **canonical source of truth** for the
project package manager. It also narrows scope where needed:

- Existing Cedar apps remain effectively yarn apps until migrated
- Existing apps are migrated via a **separate codemod** in
  `@cedarjs/codemods`
- `create-cedar-rsc-app` is **out of scope**
- `downloadYarnPatches()` is **removed** rather than generalized
- Cross-package-manager automated validation is expanded carefully without
  slowing normal PR CI

## Goals

- Support `yarn`, `npm`, and `pnpm` for Cedar Apps
- Eliminate hardcoded `yarn` execution in Cedar app tooling
- Centralize package-manager behavior in one reusable abstraction
- Make package-manager choice explicit and cheap to read via `cedar.toml`
- Keep migration risk low for existing yarn-based Cedar apps
- Support package-manager-specific scaffolding and Docker output where needed

## Non-Goals

- Supporting `create-cedar-rsc-app` in this effort
- Auto-detecting the project package manager from lockfiles at runtime
- Preserving Yarn patch support
- Guaranteeing feature-equivalent implementations for every package-manager
  operation
- Running the full test matrix for all package managers on every PR

## Source of Truth

`cedar.toml` will be the **canonical source of truth** for a Cedar app's package
manager.

New top-level config field:

- `packageManager = "yarn" | "npm" | "pnpm"`

### Why

Reading `cedar.toml` is cheaper and more explicit than probing for multiple lock
files. It also avoids ambiguity and keeps package-manager selection under Cedar
control rather than inferring it from filesystem state.

### Rules

- Cedar runtime/package-manager helpers read `packageManager` from `cedar.toml`
- No lockfile fallback is used for package-manager selection
- Lockfile conflicts are not handled by Cedar tooling
- If users leave multiple lockfiles in a project, that is considered their
  responsibility
- If `packageManager` is missing, the project is treated as an older app that
  has not yet been migrated and defaults back to yarn.

## Existing App Migration

Existing Cedar apps only support yarn today, so older apps will need an
explicit migration step.

### Codemod

Add a **separate codemod** in `@cedarjs/codemods` that writes:

- `packageManager = "yarn"`

into `cedar.toml`.

This should follow the same pattern as the existing codemod infrastructure in
that package rather than being embedded in the CLI upgrade flow.

### Behavior for Older Apps

Before the codemod has been run:

- tooling should treat the app as an old Cedar app
- the migration path should be clearly documented
- user-facing errors should direct the user to run the codemod

The CLI should not silently infer npm or pnpm for older apps.

## Architecture: Abstraction Layer in `@cedarjs/cli-helpers`

**Location:** `packages/cli-helpers/src/lib/packageManager/`

**Sub-path export:** `@cedarjs/cli-helpers/packageManager`

This mirrors the existing sub-path export pattern already used elsewhere in the
repo.

## Package Manager Type

Create a shared type:

- `type PackageManager = 'yarn' | 'npm' | 'pnpm'`

Use this type consistently across CLI helpers, config parsing, templates, and
telemetry.

## Modules

### 1. `config.ts`

Reads the canonical package-manager value from `cedar.toml`.

Proposed API:

- `getPackageManager(cwd?): PackageManager` (fall back to yarn)

Responsibilities:

- load Cedar project config
- read `packageManager`
- validate it against the supported union
- provide a small, centralized entry point for callers

### 2. `commands.ts`

Pure command generators that translate semantic operations into a concrete
command and arguments.

Prefer returning a structured object rather than a tuple so the abstraction can
grow without churn.

Suggested return shape:

- `{ command: string, args: string[] }`

Suggested functions:

- `installPackages(opts?)`
- `addRootPackages(packages, opts?)`
- `addWorkspacePackages(workspace, packages, opts?)`
- `runScript(script, opts?)`
- `runWorkspaceScript(workspace, script, opts?)`
- `runBin(bin, args?, opts?)`
- `runWorkspaceBin(workspace, bin, args?, opts?)`
- `dlx(command, args?)`
- `dedupe(opts?)`

### 3. `helpers.ts`

Higher-level wrappers that combine config lookup + command generation +
execution via `execa`, plus task wrappers where appropriate.

Suggested functions:

- `installPackagesTask(cwd)`
- `addWorkspacePackagesTask(side, packages, dev?)`
- `addRootPackagesTask(packages, dev?)`
- `runPackageManagerCommand(...)` where useful for internal reuse

### 4. `display.ts`

Utilities for rendering user-facing commands in logs, warnings, and next-step
messages.

This should be separate from execution so help text stays correct.

Suggested functions:

- `formatCedarCommand(args, opts?)`
- `formatWorkspaceScriptCommand(workspace, script, opts?)`
- `formatBinCommand(bin, args, opts?)`
- `formatDlxCommand(command, args, opts?)`

### 5. `index.ts`

Barrel export for the sub-path only if absolutely necessary. Barrel exports is
an old standard we're generally trying to move away from.

## Design Principle: Semantic Operations, Not Raw PM Calls

Call sites should ask for the operation they want to perform rather than
assembling package-manager-specific invocations themselves.

Examples:

- "add packages to root"
- "add packages to workspace"
- "run this workspace script"
- "run this local binary"
- "run a one-off package command"

This keeps package-manager differences centralized and makes migrations much
safer.

## Command Semantics

### Install dependencies

- yarn: `yarn install`
- npm: `npm install`
- pnpm: `pnpm install`

### Add packages to root

- yarn: `yarn add ...`
- npm: `npm install ...`
- pnpm: `pnpm add ...`

Dev dependency variants:

- yarn: `yarn add -D ...`
- npm: `npm install -D ...`
- pnpm: `pnpm add -D ...`

### Add packages to workspace

- yarn: `yarn workspace <workspace> add ...`
- npm: `npm install ... -w <workspace>`
- pnpm: `pnpm add ... --filter <workspace>`

### Run root script

- yarn: `yarn <script>`
- npm: `npm run <script>`
- pnpm: `pnpm <script>`

### Run workspace script

- yarn: `yarn workspace <workspace> <script>`
- npm: `npm run <script> -w <workspace>`
- pnpm: `pnpm <script> --filter <workspace>`

### Run local binary

- yarn: use package-manager-native binary execution where appropriate
- npm: prefer `npx` when the operation is "run a binary"
- pnpm: `pnpm exec <bin>`

The exact mapping should be centralized and tested in the abstraction rather
than duplicated at call sites.

### One-off execution

- yarn: `yarn dlx ...`
- npm: `npx ...`
- pnpm: `pnpm dlx ...`

### Dedupe

- yarn: `yarn dedupe`
- npm: silently skip
- pnpm: silently skip

This is intentionally capability-based. Cedar does not need a generalized
cross-package-manager dedupe abstraction beyond this behavior.

## Migration Scope

### `@cedarjs/cli-helpers`

Introduce the new package-manager abstraction and migrate existing install
helpers to delegate to it.

#### `src/lib/installHelpers.ts`

Replace current `execa('yarn', ...)` usage with the new abstraction while
keeping the same export names for backward compatibility.

This preserves existing import surfaces while centralizing behavior.

### `@cedarjs/cli`

Migrate hardcoded `yarn` usages to semantic operations from
`@cedarjs/cli-helpers/packageManager`.

Likely behavior categories:

- install dependencies
- add root dependencies
- add workspace dependencies
- run root/workspace scripts
- run binaries
- one-off package execution
- dedupe
- render user-facing commands

Representative call sites include:

- `src/lib/index.js`
- `src/lib/packages.js`
- `src/commands/test/testHandler.ts`
- `src/commands/test/testHandlerEsm.ts`
- `src/commands/upgrade/upgradeHandler.ts`
- `src/commands/setup/ui/libraries/*`
- `src/commands/setup/i18n/i18nHandler.js`
- `src/commands/setup/package/packageHandler.js`
- `src/commands/setup/auth/auth.js`
- `src/commands/setup/docker/dockerHandler.js`
- `src/commands/serveWebHandler.ts`
- `src/commands/serveApiHandler.ts`
- `src/commands/serveBothHandler.ts`
- `src/commands/lint.ts`
- `src/commands/type-checkHandler.ts`
- `src/commands/experimental/*`
- `src/commands/generate/*`
- `src/commands/build/buildPackagesTask.js`
- `src/commands/deploy/serverlessHandler.js`
- `src/lib/updateCheck.ts`

### `@cedarjs/testing`

Add `@cedarjs/cli-helpers` as a dependency and replace hardcoded yarn-based
invocations with abstraction calls.

### `@cedarjs/internal`

Add `@cedarjs/cli-helpers` as a dependency and replace hardcoded yarn-based
invocations with abstraction calls.

### `@cedarjs/auth-providers/dbAuth/setup`

Replace hardcoded package-manager execution with the abstraction.

## Config Changes

### `packages/project-config/src/config.ts`

Add:

- `packageManager?: 'yarn' | 'npm' | 'pnpm'`

Even though it is optional at the type level for backward compatibility, the
long-term expectation is that Cedar apps declare it explicitly.

### `packages/project-config/cedar-toml-schema-2.1.0.json`

Add top-level `packageManager` as a string enum:

- `yarn`
- `npm`
- `pnpm`

Keep the existing schema file (cedar-toml-schema-2.0.json) and add a new file
with version 2.1.0 and the new `packageManager` field.

### Validation and Error Handling

When `packageManager` is missing:

For now:

- sliently fall back to yarn

For a future update (not in scope now):

- surface a targeted error for commands that require package-manager execution
- direct users to the codemod for upgrading existing apps

When `packageManager` is invalid:

- surface a clear validation error that lists supported values

## Template Changes

## `create-cedar-app`

Add package-manager selection during scaffolding.

### Selection

- Add both `--pm` and `--packageManager` flags
- Treat them as equivalent aliases, following the existing style of supporting
  both long and short-form flags such as `--typescript` and `--ts`
- Interactive prompt when neither flag is provided
- Default prompt value can be derived from `npm_config_user_agent`

The invoker package manager should only be used as a **default for scaffolding**,
not as the project source of truth after generation.

### Generated project config

Write `packageManager = "<selected>"` to the generated `cedar.toml`.

### Template layout recommendation

Use a **shared base template** plus **small package-manager-specific overlay
directories**.

This is preferable to placing all package-manager-specific files directly in the
base template because:

- it keeps the base template focused on common files
- it avoids clutter and conditional deletion logic
- it makes PM-specific file ownership obvious
- it scales better if PM-specific differences grow slightly over time

Recommended structure:

- base template directory for shared app files
- overlay directory for yarn-only files
- overlay directory for npm-only files
- overlay directory for pnpm-only files

Generation flow:

1. copy base template
2. copy package-manager-specific overlay
3. apply variable substitution if needed

### PM-specific files

#### Yarn

Keep current yarn-specific files, including:

- `.yarnrc.yml`
- any other required yarn-specific config files
- `packageManager` field in `package.json` for yarn version pinning

#### npm

Generate npm-appropriate files only, including npm-specific metadata needed to
support the same dependency policy currently expressed through Yarn
`resolutions`.

Do not include yarn-specific files.

#### pnpm

Generate pnpm-appropriate files, including:

- `pnpm-workspace.yaml`
- `packageManager` field in `package.json` for pnpm version pinning
- any other required pnpm-specific files

Do not include yarn-specific files.

### Package.json workspaces and PM-specific dependency metadata

Continue using workspaces in `package.json` as today where appropriate.

For pnpm, still generate `pnpm-workspace.yaml` as the explicit pnpm-specific
workspace file.

The base `create-cedar-app` templates currently use Yarn `resolutions`. That
needs to work across all supported package managers.

Recommendation:

- keep the shared dependency intent centralized in template generation
- emit package-manager-specific metadata during scaffolding:
  - Yarn: `resolutions`
  - npm: `overrides`
  - pnpm: `pnpm.overrides`

This should be treated as part of app generation support for package-manager
agnosticism, not deferred as a future migration concern.

## `create-cedar-rsc-app`

Out of scope.

It may remain yarn-specific for now.

Do not include `create-cedar-rsc-app` work in this implementation plan.

## Docker Templates

Docker behavior should be package-manager-specific rather than trying to force
a single abstract "focus" operation.

### Recommendation

Use either:

- separate Docker templates per package manager, or
- one template with explicit package-manager-specific placeholders that are
  replaced during generation

Either approach is acceptable, but the important part is that the generated
Dockerfile contains package-manager-correct install commands.

Example direction:

- yarn can continue using yarn-specific focused-install behavior where relevant
- pnpm can generate commands like `pnpm install --filter api --prod`
- npm can generate npm-appropriate install commands

This should be treated as template generation, not as a generic runtime helper
feature.

## Upgrade System

### `packages/cli/src/commands/upgrade/upgradeHandler.ts`

- replace yarn install calls with abstraction-based install calls
- keep `dedupe()` behavior only for yarn
- remove `downloadYarnPatches()` entirely

### Yarn patches

Cedar will not continue supporting this mechanism here.

If projects have legacy Yarn patch artifacts, handling them is outside the scope
of this implementation.

## User-Facing Messages

Replace hardcoded `yarn` references in output strings with package-manager-aware
display helpers.

This includes messages in packages such as:

- `packages/vite`
- `packages/project-config`
- `packages/cli`
- `packages/create-cedar-app`

Do not simply interpolate the PM name into old strings. Generate display
commands based on the operation being described.

Examples of operations that need proper rendering:

- run a Cedar CLI command
- run a workspace script
- run a local binary
- run a one-off package command

## Telemetry

Update telemetry to report the configured project package manager instead of
assuming Yarn.

Suggested field:

- `projectPackageManager`

If useful later, invoker package manager can be added separately, but it should
not replace the configured project package manager.

## Testing Strategy

CI is already slow, especially around CLI tests, so the test strategy must stay
tight.

## 1. Keep new automated tests narrow

Add a small targeted test suite for the new abstraction itself.

Focus on:

- reading `packageManager` from `cedar.toml`
- fallback to yarn when `packageManager` is missing
- error behavior when `packageManager` is invalid
- command generation for each supported package manager
- display-command formatting where useful

These tests should be pure and fast, avoiding expensive end-to-end setup. Use
memfs to avoid filesystem operations

## 2. Avoid broad new per-PR cross-PM test expansion

Do **not** run the full existing test suite for yarn, npm, and pnpm on every
PR.

That would increase CI time too much.

## 3. Manual fixture generation support

Add a `--packageManager` flag to:

- `tasks/test-project/rebuild-test-project-fixture.mts`
- `tasks/rebuild-test-project.mts`

This allows manual generation of test fixtures for npm and pnpm so changes can
be exercised intentionally when needed.

## 4. Scheduled full-matrix validation

Run the full current test suite with:

- yarn
- npm
- pnpm

on a **scheduled CI workflow**, for example daily, rather than on every PR.

This provides regular confidence without inflating normal feedback cycles.

## 5. Release-process support

Make it easy to trigger the full package-manager CI matrix manually as part of
the release process.

This can be done through a dedicated script, workflow dispatch, or similar
mechanism so release validation can intentionally cover all package managers.

## 6. Manual verification checklist

In addition to narrow automated coverage, keep a short manual checklist for:

- scaffold a new app with yarn
- scaffold a new app with npm
- scaffold a new app with pnpm
- install dependencies
- run dev/test/build commands
- verify generated PM-specific files
- verify Docker output for each PM where applicable

## Open Questions

### 1. Template implementation detail

Base template + PM-specific overlays is the recommended direction.

The remaining implementation detail is how much substitution logic is still
needed after overlay copy.

A good target is:

- overlays for PM-specific files
- variable replacement only for a small number of command strings or metadata
  fields

### 2. Older apps without `packageManager`

These should be treated as unmigrated older Cedar apps and always fall back to
yarn rather than falling back to lockfile detection.

### 3. Legacy package-manager-specific metadata

The base `create-cedar-app` templates currently rely on Yarn `resolutions`, so
package-manager-specific dependency metadata is in scope for scaffolding.

Planned direction:

- Yarn apps emit `resolutions`
- npm apps emit `overrides`
- pnpm apps emit `pnpm.overrides`

Automatic migration of existing user-managed metadata between these formats is
still out of scope for this effort.

## Suggested Order of Implementation

1. Add `packageManager` to `cedar.toml` config types and schema
2. Add package-manager config lookup in
   `packages/cli-helpers/src/lib/packageManager/`
3. Implement semantic command generators and display helpers
4. Add small fast tests for config lookup and command generation
5. Migrate `installHelpers.ts` to delegate to the new abstraction
6. Migrate the remaining CLI/testing/internal/auth-provider call sites
7. Remove `downloadYarnPatches()`
8. Update user-facing messages to use display helpers
9. Update `create-cedar-app` with PM selection, config writing, and template
   overlays
10. Update Docker generation for PM-specific output
11. Add `--packageManager` support to fixture rebuild scripts
12. Add scheduled CI coverage for full test-suite runs across yarn, npm, and
    pnpm
13. Add or document manual release-process triggering for the full PM matrix
14. Add the separate `@cedarjs/codemods` migration for existing apps to write
    `packageManager = "yarn"`

## Implementation Decisions

- Keep the abstraction semantic and centralized
- Do not add lockfile probing as a fallback path
- Do not expand scope to `create-cedar-rsc-app`
- Do not preserve Yarn patch download behavior
- Prefer explicit package-manager-specific generation over fake equivalence
  where commands differ materially
- Keep test additions small and fast on normal PRs
