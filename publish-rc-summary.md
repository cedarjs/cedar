# Release Candidate Publishing Script Summary

## Overview
Created `cedar/.github/scripts/publish-release-candidate.ts` to handle complex multi-phase RC publishing for Cedar framework.

## Script Purpose
Replaces simple lerna publish in `.github/workflows/publish-release-candidate.yml` with advanced workflow:

1. **Temporarily removes create-cedar-app from workspaces** (avoids chicken-and-egg problem)
2. **Publishes all packages except create-cedar-app** using lerna canary mode
3. **Restores workspace configuration**
4. **Updates create-cedar-app templates** with published RC versions
5. **Generates yarn.lock files** for each template
6. **Updates JavaScript templates** using `yarn ts-to-js`
7. **Publishes create-cedar-app** with updated templates

## Key Technical Decisions

### Version Calculation
- Uses **distance-based RC numbering** (e.g., `0.12.0-rc.17`) matching existing pattern
- Leverages lerna's `--canary` mode with `--preid rc` for commit distance calculation
- Branch format: `release/{semver}/v{version}` → extracts semver type for `pre{semver}` command

### Workspace Manipulation
- Uses workspace removal approach (not private flag) based on existing `removeCreateCedarAppFromWorkspaces()` function
- Commits temporary workspace changes, then git resets to restore cleanly

### Template Updates
- Updates 12 package.json files across 4 templates (ts, js, esm-ts, esm-js)
- Each template has root + web + api package.json files
- Also updates workspace dependencies across all packages

### Yarn Lock Generation
- Creates empty `yarn.lock` files first (required for yarn to treat templates as separate projects)
- Runs `yarn install` in each template directory
- Cleans up node_modules and .yarn directories after generation

## Critical Implementation Details

### Git Configuration
- Must set git identity early: `git config user.name/email` before any commits
- Required for CI environments with no default git identity

### Error Handling
- Robust cleanup: restores workspaces even on script failure
- Uses try-catch with cleanup functions

### Dry-Run Mode
- `--dry-run` flag answers 'n' to lerna publish prompts
- Runs all operations for real except actual npm publishing
- Minimal mocking - only skips publishing commands

## Key Fixes Applied
1. **Missing closing quote** in regex replacement: `"@cedarjs/$1": "${version}"` 
2. **Git identity setup** before any git operations
3. **Empty yarn.lock creation** before yarn install in templates
4. **Proper workspace restoration** timing and error handling

## Environment Variables
- `NPM_AUTH_TOKEN` (not needed for dry-run)
- `GITHUB_REF_NAME` (e.g., `"release/minor/v0.11.3"`)

## Testing
- Dry-run mode for safe local testing
- Can use Verdaccio local registry for full integration tests
- Setup scripts provided in `.github/scripts/setup-local-testing.sh`

## Files Modified
- `cedar/.github/scripts/publish-release-candidate.ts` (new)
- `cedar/.github/workflows/publish-release-candidate.yml` (updated to call script)