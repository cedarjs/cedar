# Cedar Cache Investigation Guide

## Problem

CI builds fail intermittently when Nx caching is enabled, but work reliably when using `--skipNxCache --skipRemoteCache` flags. This makes builds very slow (70+ packages rebuilt every time).

**Key Question**: Why does disabling Nx caching fix the underlying issue?

## Investigation Tools

Located in `tasks/framework-tools/tarsync/`:

- **`debug-master.mts`** - Orchestrates all investigations and generates summary
- **`debug-cache-investigation.mts`** - Compares cached vs non-cached build behavior
- **`debug-env-differences.mts`** - Analyzes environment differences between scenarios
- **`debug-task-scheduling.mts`** - Examines Nx task execution patterns

## Running the Investigation

### In CI Environment

**Quick Investigation** (recommended first):

```bash
cd /path/to/cedar
yarn tsx tasks/framework-tools/tarsync/debug-master.mts quick
```

**Full Investigation** (if quick doesn't reveal issue):

```bash
yarn tsx tasks/framework-tools/tarsync/debug-master.mts all
```

## GitHub CI Integration

### Setup for CI Investigation

**1. Create Investigation Workflow**

Add `.github/workflows/cache-investigation.yml`:

```yaml
name: Cache Investigation
on:
  workflow_dispatch:
    inputs:
      investigation_type:
        description: 'Type of investigation to run'
        required: true
        default: 'quick'
        type: choice
        options:
          - quick
          - full
          - cache-only
          - env-only

jobs:
  investigate:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'yarn'

      - name: Install dependencies
        run: yarn install --frozen-lockfile

      - name: Run Cache Investigation
        run: |
          echo "🔍 Starting cache investigation: ${{ inputs.investigation_type }}"
          case "${{ inputs.investigation_type }}" in
            "quick")
              yarn tsx tasks/framework-tools/tarsync/debug-master.mts quick
              ;;
            "full") 
              yarn tsx tasks/framework-tools/tarsync/debug-master.mts all
              ;;
            "cache-only")
              yarn tsx tasks/framework-tools/tarsync/debug-cache-investigation.mts
              ;;
            "env-only")
              yarn tsx tasks/framework-tools/tarsync/debug-env-differences.mts
              ;;
          esac

      - name: Upload Investigation Reports
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: cache-investigation-reports
          path: |
            cache-investigation-report.json
            environment-analysis-report.json
          retention-days: 30

      - name: Comment Results on Issue
        if: github.event.issue.number
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            let comment = '## 🔍 Cache Investigation Results\n\n';

            try {
              if (fs.existsSync('cache-investigation-report.json')) {
                const report = JSON.parse(fs.readFileSync('cache-investigation-report.json', 'utf8'));
                comment += `**Cache Analysis**: ${report.summary?.keyFindings?.length || 0} key findings\n`;
              }
              if (fs.existsSync('environment-analysis-report.json')) {  
                const envReport = JSON.parse(fs.readFileSync('environment-analysis-report.json', 'utf8'));
                comment += `**Environment Analysis**: ${envReport.summary?.criticalDifferences || 0} critical differences\n`;
              }
              comment += '\n📁 Full reports available in workflow artifacts.';
            } catch (e) {
              comment += '❌ Investigation failed. Check workflow logs for details.';
            }

            await github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: comment
            });
```

**2. Add to Existing CI Workflow**

Add investigation step to your main CI workflow:

```yaml
- name: Run Cache Investigation (on failure)
  if: failure() && contains(github.event.head_commit.message, '[investigate]')
  run: |
    echo "🔍 Build failed, running cache investigation..."
    yarn tsx tasks/framework-tools/tarsync/debug-master.mts quick
  continue-on-error: true

- name: Upload Debug Reports (on failure)
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: debug-reports-${{ github.run_id }}
    path: '*-report.json'
```

### Execution Options

**Option 1: Manual Trigger**

- Go to Actions → Cache Investigation → Run workflow
- Select investigation type and run
- Download artifacts when complete

**Option 2: Automatic on Failure**

- Add `[investigate]` to commit message
- If CI fails, investigation runs automatically
- Results uploaded as artifacts

**Option 3: Issue-Triggered**

- Comment `/investigate` on an issue
- Investigation runs and posts results back to issue

### Using the GitHub Workflow

**Manual Investigation** (recommended):

1. Go to **Actions** → **Cache Investigation** in GitHub
2. Click **Run workflow**
3. Select investigation type:
   - `quick` - Fast analysis (recommended first)
   - `full` - Complete investigation
   - `cache-only` - Only cache behavior analysis
   - `env-only` - Only environment comparison
4. Click **Run workflow** and wait for completion
5. Download artifacts when finished

**Automatic Investigation on CI Failure**:

1. Add `[investigate]` to your commit message
2. Push the commit to trigger CI
3. If any CI job fails, cache investigation runs automatically
4. Results are uploaded as artifacts with run ID in the name

### Accessing Results

**From Workflow UI**:

1. Go to Actions → Select workflow run
2. Download "cache-investigation-reports" artifact
3. Unzip and examine JSON files

**From CLI** (with GitHub CLI):

```bash
# List recent workflow runs
gh run list --workflow="cache-investigation.yml"

# Download artifacts from specific run
gh run download cache-investigation-reports < run-id > --name
```

### Individual Components

```bash
# Cache behavior analysis
yarn tsx tasks/framework-tools/tarsync/debug-cache-investigation.mts

# Environment comparison
yarn tsx tasks/framework-tools/tarsync/debug-env-differences.mts

# Task scheduling analysis
yarn tsx tasks/framework-tools/tarsync/debug-task-scheduling.mts
```

### CI-Specific Considerations

**Environment Differences**:

- CI runners have different filesystem performance characteristics
- Network-attached storage may have different caching behavior
- Parallel job execution can create race conditions not seen locally

**Timing Considerations**:

- CI investigations take 10-15 minutes for quick analysis
- Full investigation may take 20-30 minutes
- Set appropriate timeouts in workflow configuration

**Resource Limits**:

- Monitor disk space usage during investigation
- Large cache directories may exceed runner storage limits
- Consider cleanup steps if investigation generates large artifacts

**Security Notes**:

- Investigation tools don't access secrets or sensitive data
- Generated reports contain file paths and environment variables
- Review reports before sharing outside the team

### CI Troubleshooting

**Common Issues**:

```bash
# Permission errors
sudo chown -R $(whoami) .nx/cache

# Disk space issues
df -h
du -sh .nx/cache

# Memory issues
free -h
```

**Workflow Failures**:

- **Timeout**: Increase `timeout-minutes` in workflow
- **Out of disk space**: Add cleanup step before investigation
- **Permission denied**: Check file ownership and runner permissions
- **Missing reports**: Verify investigation completed successfully

**Debugging Failed Investigations**:

```yaml
- name: Debug Investigation Failure
  if: failure()
  run: |
    echo "=== Investigation Debug Info ==="
    ls -la *-report.json || echo "No reports generated"
    df -h
    free -h
    echo "=== Nx Cache Status ==="
    ls -la .nx/cache || echo "No cache directory"
```

### Monitoring Investigation Progress

**Live Monitoring** (during workflow execution):

- Watch Actions tab for real-time logs
- Look for color-coded investigation output
- Monitor artifact generation in workflow summary

**Key Log Patterns to Watch**:

- `🔍 Starting cache investigation` - Investigation begun
- `📊 Cache Behavior Comparison` - Cache analysis running
- `🌍 Environment & Execution Differences Analysis` - Environment comparison
- `✅ Investigation completed` - Successful completion
- `❌ Investigation failed` - Check logs for specific errors

## Expected Outputs

**Generated Reports**:

- `cache-investigation-report.json` - File state comparisons and cache behavior
- `environment-analysis-report.json` - System state differences and recommendations
- Console output with color-coded findings and immediate insights

**Key Metrics**:

- Files missing in cached vs non-cached scenarios
- Cache hit/miss rates and performance impact
- Environment differences that could affect builds
- Task execution timing and dependencies

## What to Look For

**🚨 Critical Issues**:

- Files existing in no-cache but missing in cache scenarios
- Cache serving stale/incorrect artifacts
- Environment variable conflicts affecting Nx behavior
- File permission differences between scenarios

**⚠️ Warning Signs**:

- Different task execution orders
- Memory/disk usage anomalies
- Cache directory access issues
- Timing-sensitive race conditions

## Next Steps Based on Findings

### Cache Invalidation Issues

- Review `nx.json` cache input/output definitions
- Check if file change detection patterns are correct
- Test with cache clearing: `yarn nx reset`

### Environment Issues

- Fix critical permission/filesystem problems
- Standardize CI environment variables
- Verify Node/Yarn/Nx versions match between scenarios

### Race Conditions

- Add explicit synchronization between build steps
- Consider sequential execution for problematic packages
- Investigate parallel task dependencies

## Success Criteria

Investigation succeeds if it identifies:

1. **Root cause** of why cache causes failures
2. **Specific fix** to re-enable fast cached builds
3. **Verification method** to confirm fix works in CI

**Goal**: Remove `--skipNxCache --skipRemoteCache` flags and restore fast, reliable CI builds.
