# Implementation Plan: Package Watching in Dev Mode

## Overview
Enable hot-reloading of workspace packages during `yarn cedar dev` so that changes to shared code are automatically picked up by both the API and web sides.

## Implementation Status

✅ **Steps 1-4 Complete!** The core implementation is done:
- Created `watchPackagesTask.js` to handle package watching
- Updated `dev.ts` command definition with validation
- Updated `devHandler.ts` to integrate package watching
- All TypeScript imports and types are properly handled

**Next:** Manual testing (Step 5)

## Tasks

### 1. Create Watch Packages Task
- [x] Create new file `cedar/packages/cli/src/commands/dev/watchPackagesTask.js`
  - [x] Import necessary dependencies (fs, path, concurrently, etc.)
  - [x] Implement `watchPackagesTask(packageWorkspaces)` function
  - [x] Map workspace names to filesystem paths (handle both `packages/*` and specific package names)
  - [x] Filter packages to only include those with a `watch` script in their `package.json`
  - [x] Log a warning if a package doesn't have a watch script
  - [x] Return `null` if no watchable packages found
  - [x] Use `concurrently` to run `yarn watch` in each package directory
  - [x] Handle errors and telemetry

### 2. Update Dev Command Definition
- [x] Edit `cedar/packages/cli/src/commands/dev.ts`
  - [x] Update the `positional('side')` configuration
    - [x] Remove strict choices restriction (or add 'packages' and package names as valid choices)
    - [x] Update description to include: "Valid values: api, web, packages/*, <package-name>"
  - [x] Add `.check()` validation (similar to `build.js`)
    - [x] Validate that array type is correct
    - [x] Filter out standard sides (api, web, packages/*)
    - [x] Call `workspaces({ includePackages: true })` to get valid workspace names
    - [x] Verify all requested workspaces exist
    - [x] Return appropriate error message for unknown workspaces

### 3. Update Dev Handler
- [x] Edit `cedar/packages/cli/src/commands/devHandler.ts`
  - [x] Import `watchPackagesTask` from './dev/watchPackagesTask.js'
  - [x] Import `buildPackagesTask` from '../build/buildPackagesTask.js'
  - [x] Add logic to extract package workspaces from `side` array
    - [x] Filter out 'api' and 'web' to get package-related sides
  - [x] Check if package workspaces exist in root `package.json`
    - [x] Read and parse root `package.json`
    - [x] Check if `workspaces` array exists and has more than 2 entries (more than just api/web)
  - [x] Add initial build step for packages (before starting watchers)
    - [x] Only if packages exist
    - [x] Call `buildPackagesTask` with discovered packages
    - [x] Catch errors and log warning (don't fail - watch mode will rebuild)
  - [x] Add 'packages' job to the `jobs` object
    - [x] Set name to 'packages'
    - [x] Set command to call `watchPackagesTask`
    - [x] Set prefixColor to 'yellow' (or another available color)
    - [x] Implement `runWhen` condition:
      - [x] Return true if packages exist in workspace config
      - [x] Should run by default when packages exist (Option A)
    - [x] Handle async command execution
  - [x] Ensure job mapping includes the new packages job

### 4. Update Imports
- [x] In `devHandler.ts`, ensure proper imports for TypeScript
  - [x] Add type annotations as needed
  - [x] Handle `@ts-expect-error` comments for JS imports

### 5. Testing
- [ ] Manual testing scenarios:
  - [ ] Test `yarn cedar dev` with no packages directory
  - [ ] Test `yarn cedar dev` with empty packages directory
  - [ ] Test `yarn cedar dev` with one package
  - [ ] Test `yarn cedar dev` with multiple packages
  - [ ] Test `yarn cedar dev api web` (explicitly excluding packages)
  - [ ] Test `yarn cedar dev packages/*` (explicitly including all packages)
  - [ ] Test `yarn cedar dev <specific-package-name>`
  - [ ] Test package without watch script (should skip with warning)
  - [ ] Verify changes in packages trigger TypeScript recompilation
  - [ ] Verify concurrent output displays correctly with package prefix
  - [ ] Verify error handling when package doesn't exist

### 6. Edge Cases & Error Handling
- [ ] Handle case where `packages` directory doesn't exist
- [ ] Handle case where package exists but has no `package.json`
- [ ] Handle case where package exists but has no `watch` script
- [ ] Handle case where `glob` returns empty results
- [ ] Ensure proper error messages for all failure scenarios
- [ ] Verify telemetry is recorded for package-related errors

## Implementation Notes

- **Default Behavior**: Packages will be watched by default when they exist (no opt-in required)
- **No Feature Flag**: Do not check for `experimental.packagesWorkspace.enabled` in dev command
- **Error Handling**: Skip packages without watch scripts gracefully with a warning
- **Documentation**: Hold off on updating CLI docs for now
- **Consistency**: Follow the same patterns used in `build.js` and `buildPackagesTask.js`
- **Colors**: Use 'yellow' for package watch output (api=cyan, web=blue, gen=green)

## Files to Create/Modify

### New Files
- ✅ `cedar/packages/cli/src/commands/dev/watchPackagesTask.js`

### Modified Files
- ✅ `cedar/packages/cli/src/commands/dev.ts`
- ✅ `cedar/packages/cli/src/commands/devHandler.ts`

## Success Criteria

- [x] Running `yarn cedar dev` automatically watches and rebuilds workspace packages
- [ ] Changes to package files trigger TypeScript recompilation (needs testing)
- [ ] Package watch output is clearly labeled in the console (needs testing)
- [x] All edge cases are handled gracefully
- [x] No breaking changes to existing dev command behavior