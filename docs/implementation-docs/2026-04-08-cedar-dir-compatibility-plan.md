# Plan: Support Both `.redwood/` and `.cedar/`

> **Status**: Implemented (April 2026)

## Implementation Summary

The plan has been fully implemented:

- **`generatedDataDir.ts`**: Created at `packages/project-config/src/generatedDataDir.ts` with `getGeneratedDataDirPath()` function that implements the resolution rules.
- **`getPaths()` updated**: Now uses `getGeneratedDataDirPath()` instead of hardcoding `.redwood`.
- **Tests added**: `generatedDataDir.test.ts` covers all four resolution cases.
- **Templates updated**: Create-app templates use `.cedar/` (gitignore, README placeholder).
- **Fixtures migrated**: Most fixtures now use `.cedar/` except `example-todo-main-with-errors` which is kept on `.redwood/` for testing compatibility.

## Goal

Add compatibility for both generated directories, `.redwood/` and `.cedar/`, in the same spirit as current support for both `redwood.toml` and `cedar.toml`.

This should let Cedar:

- continue working in upgraded RedwoodJS apps that still use `.redwood/`
- support Cedar-native apps that want `.cedar/`
- avoid breaking existing generated artifacts, TS config references, telemetry caches, and test fixtures

## Current State

The repo already centralizes config-file compatibility in `packages/project-config/src/configPath.ts`:

- `cedar.toml` is preferred when both files exist
- `redwood.toml` is used as a fallback

The generated directory does not yet have a similar abstraction. Today the path is still hardcoded in `packages/project-config/src/paths.ts`:

- `generated.base` -> `.redwood`
- `generated.schema` -> `.redwood/schema.graphql`
- `generated.types.*` -> `.redwood/types/...`
- `generated.prebuild` -> `.redwood/prebuild`

Because `getPaths()` is used widely, that hardcoded `.redwood` value flows into:

- CLI locks, logs, update-check persistence, plugin caches, console history, telemetry
- internal codegen and schema generation
- testing helpers
- app templates and fixture tsconfig/jsconfig files
- file watchers and ignore lists

## Desired Behavior

Mirror the `cedar.toml`/`redwood.toml` behavior with directory resolution rules:

1. If `.cedar/` exists, use `.cedar/`.
2. Else if `.redwood/` exists, use `.redwood/`.
3. Else default to `.cedar/` for newly created/generated output.

If both directories exist, prefer `.cedar/` for consistency with `cedar.toml` precedence.

Important non-goal for this change:

- Do not change the default API URL path `/.redwood/functions` as part of this work unless explicitly scoped separately. That is a different compatibility surface from the generated/cache directory.

## Implementation Plan

### 1. Centralize generated-directory resolution in `project-config`

Add a small abstraction next to `getConfigPath()` in `packages/project-config`:

- `getGeneratedDirName()` or `getGeneratedDirPath()`
- cache the result similarly to config-path lookup
- detect existing `.cedar/` and `.redwood/`
- default to `.cedar/` when neither exists

Then update `getPaths()` in `packages/project-config/src/paths.ts` so every generated path is derived from that helper instead of hardcoding `.redwood`.

This keeps the compatibility rule in one place and avoids ad hoc filesystem checks across packages.

### 2. Define migration and coexistence semantics

Be explicit about how the runtime behaves when old and new dirs are present:

- read/write only one generated directory per run
- prefer `.cedar/` when both exist
- do not silently merge contents from both directories
- optionally log a low-noise warning if both exist, since stale artifacts in the non-selected directory could confuse users

This decision should be documented in code comments and tests because stale generated outputs are easy to misdiagnose.

### 3. Update all consumers that assume `.redwood`

After `getPaths()` is fixed, most consumers that already use `generated.base` will inherit the new behavior automatically. The remaining work is to replace direct string literals and special cases such as:

- watcher ignore lists like `['node_modules', '.redwood']`
- cleanup scripts and fixture rebuild tasks that delete or preserve `.redwood/*`
- telemetry code that manually creates or reads `.redwood`
- comments, error messages, and help text that currently name `.redwood`

The safest approach is:

- first replace behavior-critical hardcoded paths
- then sweep remaining strings used in logs/docs/tests

### 4. Decide template strategy

There are many template and fixture files with explicit `../.redwood/...` TS path references and `.redwood` gitignore entries.

Recommended direction:

- new Cedar app templates should emit `.cedar` references
- legacy Redwood fixtures that intentionally model old apps can stay on `.redwood`
- compatibility tests should cover both layouts

This keeps new output Cedar-native without dropping support for upgraded Redwood apps.

### 5. Add compatibility tests at the abstraction boundary

Add focused tests around the new resolver, similar to `configPath.test.ts`:

- finds `.cedar` when it exists
- falls back to `.redwood` when `.cedar` does not exist
- prefers `.cedar` when both exist
- defaults to `.cedar` when neither exists yet

Then update `paths.test.ts` so expected generated paths are no longer always `.redwood`.

This is the most important test layer because many downstream packages trust `getPaths()`.

### 6. Add integration coverage for real project shapes

Add or update fixtures to cover:

- Cedar app with `cedar.toml` + `.cedar`
- upgraded Redwood app with `redwood.toml` + `.redwood`
- mixed app with `cedar.toml` + `.redwood` to confirm fallback still works
- mixed app with both dirs present to confirm `.cedar` wins

Useful integration targets:

- CLI startup / cwd detection
- type generation
- GraphQL schema generation
- test commands that persist data under the generated dir

### 7. Review fixture rebuild and cleanup tooling

Scripts under `tasks/test-project` currently contain direct `.redwood` cleanup logic. Those scripts need a deliberate update so they:

- clean the selected generated dir
- optionally clean both dirs in fixture-reset flows
- preserve whichever README/placeholder files are expected for the chosen directory

This matters because fixture tooling can otherwise hide bugs by recreating `.redwood` even after the main code switches to `.cedar`.

### 8. Update docs and upgrade guidance

After the code path is stable, document:

- `.cedar/` is the preferred generated directory for Cedar apps
- `.redwood/` remains supported for compatibility
- precedence rules when both exist
- whether users should delete stale `.redwood/` content after upgrading

This should also be reflected in create-app templates, gitignore templates, and upgrade docs.

## Suggested Execution Order

1. Add generated-dir resolver in `project-config`.
2. Rewire `getPaths()` to use it.
3. Add resolver and path tests.
4. Sweep direct `.redwood` behavior-critical usages in CLI/internal/tasks.
5. Update templates and fixture strategy.
6. Add integration coverage for both directory styles.
7. Update docs and upgrade guidance.

## Risks

- Stale artifacts if both `.cedar/` and `.redwood/` exist and the chosen directory is not obvious.
- Template drift if new apps still generate `.redwood` references while runtime defaults to `.cedar`.
- Partial migration where some packages use `getPaths()` and others still hardcode `.redwood`.
- Fixture tooling masking regressions by recreating the old directory automatically.

## Acceptance Criteria

The work is done when:

- generated-path resolution is centralized and tested
- Cedar can operate with either `.cedar/` or `.redwood/`
- `.cedar/` is the default target for new generated output
- precedence is defined and tested when both dirs exist
- no behavior-critical code paths still require `.redwood` specifically
- templates/docs are aligned with the chosen default
- **One fixture (`example-todo-main-with-errors`) intentionally kept on `.redwood/` for compatibility testing**
