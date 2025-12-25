# CedarJS Upgrade Scripts: Implementation Summary

## Overview

The CedarJS CLI now supports **dynamic pre-upgrade scripts** that can be downloaded from the GitHub repository and executed before performing an upgrade. This allows framework maintainers to check for breaking changes, validate user configurations, or display important migration information specific to each version.

## Key Design Decisions

### 1. Script Storage Location

**Decision:** Store scripts in `upgrade-scripts/` directory at the repository root.

**Rationale:**

- This is not a package, so it should not live inside the packages/ directory.
- These are scripts, and will not be published to npm
- Simple URL structure for raw GitHub content access

### 2. Version Matching Strategy

**Decision:** Three-tier matching system with wildcard support.

For a user upgrading to version `3.4.1`, the CLI checks for scripts at three specificity levels:

1. **Exact Version:** `3.4.1.ts` or `3.4.1/index.ts`
2. **Patch Wildcard:** `3.4.x.ts` or `3.4.x/index.ts` (same minor version)
3. **Minor Wildcard:** `3.x.ts` or `3.x/index.ts` (same major version)

**Important:** All matching scripts are executed (not just one).

**Rationale:**

- Flexibility to run common checks for all versions in a major/minor release
- Ability to add version-specific checks without duplicating code
- Directory support enables complex scripts with multiple files like README files and shared utilities

### 3. Manifest-Based Discovery

**Decision:** Use `upgrade-scripts/manifest.json` to list all available scripts.

**Example:** `["3.0.1.ts", "3.4.1.ts", "3.4.x.ts", "3.x.ts", "4.0.0/index.ts"]`

**Rationale:** Single HTTP request for discovery, clear inventory, local matching eliminates network round-trips.

### 4. Dependency Management & Directory Support

**Decision:** Auto-detect dependencies from script content using regex and `// @dependency:` comments. No `package.json` required.

**Directory Download:** When a script uses the directory format (e.g., `3.4.1/index.ts`), the CLI:

1. Fetches directory contents via GitHub API
2. Downloads all files to the temp directory
3. Renames `index.ts` to `script.ts` for execution
4. Adjacent files become available as relative imports

**Process:**

1. Create temp directory with downloaded script(s)
2. Extract dependencies from main script
3. Generate minimal `package.json` and run `yarn add <deps>` if needed
4. Execute with Node 24's native TypeScript support

**Rationale:** Simple scripts stay single-file; complex scripts can use helpers. No boilerplate needed in either case.

### 5. Execution Environment

**Decision:** Isolated temporary directory with full cleanup.

**Process:** Create temp dir → download script(s) → install dependencies → execute → cleanup

**Rationale:** Isolated, consistent environment prevents pollution of user's project and version conflicts.

### 6. Error Handling

**Decision:** Script failures abort upgrade by default; `--force` continues but displays errors.

**Behavior:**

- Exit 0: Continue upgrade
- Exit non-zero without `--force`: Abort, display error, exit 1
- Exit non-zero with `--force`: Continue, complete upgrade, display error, exit 0

**Rationale:** Prevents accidental incompatible upgrades while allowing force override for edge cases. Exit codes inform CI/CD of issues.

### 7. User Communication

**Decision:** Display script output after all upgrade tasks complete in a centralized summary.

**Rationale:** Non-intrusive, all information in one place, direct script output without extra formatting.

## Technical Implementation Details

### Function: `runPreUpgradeScripts()`

**Location:** `packages/cli/src/commands/upgrade.js`

**Key Features:**

- Fetches `manifest.json` once at the start
- Filters scripts locally using version matching rules
- **Directory handling:** Detects directory-based scripts (containing `/`), fetches all files via GitHub API
- Executes scripts sequentially (not in parallel)
- Accumulates all stdout output into `ctx.preUpgradeMessage`
- Stores error output in `ctx.preUpgradeError`
- Respects `--force` flag to continue on errors

**Integration Point:**
Runs as a Listr task titled "Running pre-upgrade scripts" between "Checking latest version" and "Updating your CedarJS version".

**Output Storage:**

- Stores all stdout output in `ctx.preUpgradeMessage`
- Stores error information in `ctx.preUpgradeError` with format: `Pre-upgrade check <script.name> failed:\n<error output>`
- Messages are displayed after all tasks complete:
  - Errors: `console.error()` with header "❌ Pre-upgrade Error:" followed by `process.exit(1)` (unless `--force` is used)
  - Success messages: `console.log()` with header "📣 Pre-upgrade Message:"

### Function: `extractDependencies()`

**Purpose:** Parse script content to identify npm dependencies.

**Algorithm:** Parse `// @dependency:` comments and `import` statements, filter out relative/built-in imports, extract package names.

**Returns:** Array of dependency specifiers (e.g., `['lodash@4.17.21', 'chalk']`)

### Manifest Structure

**File:** `upgrade-scripts/manifest.json`

**Purpose:** Single source of truth for available scripts, enables fast local filtering.

**Format:** Array of paths: `["3.4.1.ts", "3.x.ts", "4.0.0/index.ts"]`

## Usage Examples

### For Framework Maintainers

**Creating a version-specific script:**

```bash
# Create exact version check
cat > upgrade-scripts/3.4.1.ts << 'EOF'
// @dependency: @cedarjs/project-config

import { getConfig } from '@cedarjs/project-config'

const config = getConfig()

if (config.graphql.someSetting === 'oldValue') {
  console.log('⚠️  GraphQL configuration change detected.')
  console.log('Please update redwood.toml: graphql.someSetting = "newValue"')
  process.exit(1) // Abort upgrade
}

console.log('✓ Configuration validated.')
EOF

# Update manifest
echo '["3.4.1.ts"]' > upgrade-scripts/manifest.json

# Commit to main branch
git add upgrade-scripts/
git commit -m "Add upgrade check for v3.4.1"
```

**Creating a directory-based script with helper:**

```bash
# Create directory structure
mkdir -p upgrade-scripts/4.0.0
cat > upgrade-scripts/4.0.0/index.ts << 'EOF'
import { checkDatabase } from './helpers.js'

if (!(await checkDatabase())) {
  console.log('⚠️  Database migration required')
  process.exit(1)
}
EOF

cat > upgrade-scripts/4.0.0/helpers.ts << 'EOF'
export async function checkDatabase() {
  // Complex validation logic
  return true
}
EOF

# Update manifest
echo '["3.4.1.ts", "4.0.0/index.ts"]' > upgrade-scripts/manifest.json
```

### For End Users

**Normal upgrade:**

```bash
yarn cedar upgrade -t 3.4.1

# Output includes:
# ✓ Checking latest version
# ✓ Running pre-upgrade scripts
#   → Found upgrade check script: 3.4.1.ts
#   → Installing dependencies: @cedarjs/project-config
#   → Running pre-upgrade script: 3.4.1.ts
# ✓ Updating your CedarJS version
# ...
# 🎉 Your project has been upgraded to CedarJS 3.4.1!
#
# 📣 Pre-upgrade Message:
#
#    ⚠️ GraphQL configuration change detected...
```

**Force upgrade despite check failures:**

```bash
yarn cedar upgrade -t 3.4.1 --force

# Continues upgrade even if scripts exit with non-zero code
# The upgrade completes, but errors are displayed afterward
```

**Verbose output:**

```bash
yarn cedar upgrade -t 3.4.1 --verbose

# Shows:
# - Manifest fetch details
# - Script URL checks
# - Dependency installation logs
# - Full script execution output
```

## Key Design Insights

### 1. Progressive Complexity

Single-file scripts for simple cases; directory-based scripts when needed. Auto-dependency detection eliminates boilerplate in both cases.

### 2. Manifest Over Probing

Single HTTP request instead of 6+ HEAD probes. Fast, reliable, explicit.

### 3. Wildcard Flexibility

Three-tier matching (`3.4.1.ts`, `3.4.x.ts`, `3.x.ts`) enables both specific and broad checks without code duplication.

### 4. Directory Support Enables Modularity

Complex scripts can import helpers from adjacent files. All files in script directory are downloaded automatically.

### 5. Isolated + Force Flag = Safe + Flexible

Temp directory isolation ensures reliability. Force flag allows override while preserving error visibility.

## Migration Guide

### Adding Your First Upgrade Script

1. **Create the script:**

   ```bash
   # File: upgrade-scripts/1.0.0.ts
   console.log('Welcome to v1.0.0!')
   console.log('New features: ...')
   ```

2. **Update manifest:**

   ```json
   ["1.0.0.ts"]
   ```

3. **Commit to main:**

   ```bash
   git add upgrade-scripts/
   git commit -m "Add upgrade message for v1.0.0"
   git push origin main
   ```

4. **Test locally:**
   ```bash
   # In a Cedar project
   yarn cedar upgrade -t 1.0.0 --verbose
   ```

### Script Best Practices

**Do:**

- Keep scripts fast and focused
- Exit 1 to abort, 0 to continue
- Test before committing
- Make scripts idempotent
- Use directory format (`version/index.ts`) for scripts needing helpers, but
  strongly prefer single-file scripts for simplicity.

**Don't:**

- Modify user's filesystem
- Depend on external APIs
- Output success messages (only warnings/errors)
- Assume project structure (use `getPaths()` from `@cedarjs/project-config`)

### Script Templates

**Single file:**

```typescript
// @dependency: @cedarjs/project-config
import { getConfig } from '@cedarjs/project-config'

if (getConfig().hasIssue) {
  console.log('⚠️  Issue: ...')
  process.exit(1)
}
```

**Directory-based (with helper):**

```typescript
// upgrade-scripts/3.4.1/index.ts
import { validateConfig } from './helpers.js'

if (!(await validateConfig())) {
  console.log('⚠️  Config validation failed')
  process.exit(1)
}
```

## Related Documentation

- **User Guide:** `upgrade-scripts/README.md` - How to add scripts
- **CLI Reference:** `packages/cli/README.md` - Command-line options
- **Implementation:** `packages/cli/src/commands/upgrade.js` - Source code
- **Contributing:** `CONTRIBUTING.md` - Development workflow

## Conclusion

This upgrade scripts system balances simplicity with power: single-file scripts for simple checks, directory support for complex validation, automatic dependency management, and manifest-based discovery for performance. The design enables framework maintainers to guide users through breaking changes while keeping the barrier to contribution low.
