# Cedar Cache Investigation Guide

## Background

We have a performance vs reliability issue in our CI builds that needs investigation:

- **Problem**: CI builds are very slow because we use `--skipNxCache --skipRemoteCache` flags
- **Why we use these flags**: Without them, CI builds sometimes fail (files disappear between build and build:pack steps). The intermittent nature of the issue suggests a race condition or timing issue.
- **Goal**: Understand why disabling cache fixes the issue, so we can fix the root cause and re-enable fast cached builds

## The Mystery

**Key Question**: "Why does disabling Nx caching fix the underlying issue?"

### What We Know

- ✅ **Local builds**: Work perfectly with or without cache
- ✅ **CI with cache disabled**: Works but very slow (builds all 70+ packages)
- ❌ **CI with cache enabled**: Sometimes fails - files disappear between `build` and `build:pack` steps
- 📍 **Affected package**: Primarily `@cedarjs/testing` package

### The Original Issue

From the PR that added the cache-disabling flags:

> When setting up the test project in CI we run `yarn project:tarsync`, which runs `yarn nx run-many -t build:pack`. nx runs `build` first, then `build:pack`.
>
> The `build` step produces expected files (confirmed with debug logging). But when `build:pack` runs, some files are missing. How can files disappear between the two steps?

## Potential Root Causes

The investigation targets these 5 possibilities:

1. **Cache serving stale/incorrect artifacts** (cache invalidation issue)
2. **Cache interfering with build process** (execution environment issue)
3. **Cache changing Nx execution behavior** (avoiding real problem coincidentally)
4. **Cache affecting task scheduling/parallelization** (masking race conditions)
5. **Something else entirely** (cache disabling coincidentally avoids real issue)

## Investigation Tools

### Files Created

Located in `tasks/framework-tools/tarsync/`:

- `debug-cache-investigation.mts` - Compares file states between cache vs no-cache scenarios
- `debug-task-scheduling.mts` - Analyzes Nx task execution patterns
- `debug-env-differences.mts` - Environment and system state comparison
- `debug-master.mts` - Coordinates all investigations and generates summary

### What the Tools Do

**Cache Investigation**:

- Runs builds with and without cache
- Captures detailed file snapshots at each step
- Compares outputs, timestamps, file existence
- Identifies exactly what differs between scenarios

**Task Scheduling Analysis**:

- Monitors how Nx schedules tasks differently
- Tracks parallelization patterns
- Measures execution timing and critical paths
- Detects changes in task dependencies

**Environment Analysis**:

- Captures system state during both scenarios
- Monitors memory usage, disk space, permissions
- Tracks environment variables and process info
- Identifies execution environment differences

## Running the Investigation

### Prerequisites

1. CI environment where the issue reproduces
2. Access to run custom debug commands
3. Ability to capture and download generated reports

### Commands to Run

**Quick Investigation** (recommended first):

```bash
cd /path/to/cedar
yarn tsx tasks/framework-tools/tarsync/debug-master.mts quick
```

**Full Investigation** (if quick doesn't reveal issue):

```bash
yarn tsx tasks/framework-tools/tarsync/debug-master.mts all
```

**Individual Components** (if needed):

```bash
# Just cache behavior
yarn tsx tasks/framework-tools/tarsync/debug-master.mts cache

# Just environment analysis
yarn tsx tasks/framework-tools/tarsync/debug-master.mts environment

# Just task scheduling
yarn tsx tasks/framework-tools/tarsync/debug-master.mts scheduling
```

## GitHub CI Integration

### Accessing Investigation Results

**After a Failed CI Run**:

1. Go to the failed workflow run in GitHub Actions
2. Look for the "Cache Investigation" job
3. Download the `debug-reports-{run-id}` artifact
4. Unzip and examine the JSON files for analysis

**From CLI** (with GitHub CLI):

```bash
# List recent failed runs
gh run list --status=failure

# Download artifacts from specific failed run
gh run download <run-id> --name debug-reports-<run-id>
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

The investigation will generate:

1. **Console Output**: Real-time analysis with color-coded findings
2. **JSON Reports**:
   - `cache-investigation-report.json` - Detailed file state comparisons
   - `environment-analysis-report.json` - System state differences
3. **Summary Report**: Prioritized findings and next steps

### What to Look For

**🚨 Critical Findings** (fix these first):

- File permission differences
- Missing directories between scenarios
- Environment variable conflicts
- Critical Nx configuration issues

**⚠️ Key Patterns**:

- Files existing in no-cache but missing in cache scenarios
- Different task execution orders
- Memory/disk usage anomalies
- Timing-sensitive race conditions

**✅ Success Indicators**:

- Both scenarios succeed but files differ → Cache invalidation issue
- Cache scenario fails but no-cache succeeds → Confirms cache is the problem
- Environment differences detected → System configuration issue

## Interpreting Results

### If Cache vs No-Cache Show Different Outcomes

```
With cache: FAILED
Without cache: SUCCESS
```

**→ Cache is definitely the problem. Focus on cache invalidation.**

### If Both Succeed But Files Differ

```
With cache: SUCCESS
Without cache: SUCCESS
But different files produced
```

**→ Cache serving stale artifacts. Check Nx cache configuration.**

### If No Obvious Differences

```
Environment consistent
File states similar
Task scheduling identical
```

**→ Issue may be timing-sensitive or CI-specific. Need deeper investigation.**

## Automatic @cedarjs/testing Investigation

### How It Works

The `@cedarjs/testing` package now includes **automatic cache investigation** that captures data on every build:

**Data Captured Per Build**:

- Environment info (Node version, platform, CI detection)
- Nx cache state (enabled/disabled, cache directory status, entry count)
- File system state (package.json, build script, src/dist/config directories)
- Build outcome (success/failure, duration, error messages)
- Git commit hash for correlation

**Automatic Analysis**:

- Pattern detection across multiple builds
- Success/failure correlation with cache usage
- Environment and timing pattern analysis
- File count difference detection
- Critical finding identification

### Using the Automatic Investigation

**View Analysis (in testing package directory)**:

```bash
# Quick summary of patterns and recommendations
yarn cache:analyze

# Detailed analysis with build history
yarn cache:analyze:detailed

# Show recent build history only
yarn cache:analyze:history
```

**CI Integration**:

- Investigation data is automatically captured during CI builds
- Reports are uploaded as artifacts: `cache-investigation-reports-{os}-{run-id}`
- Download artifacts from failed CI runs for local analysis
- No configuration needed - works out of the box

**Investigation Data Location**:

- Local: `packages/testing/.cache-investigation/`
- CI: Available as workflow artifacts
- Reports are automatically cleaned up (keeps last 20)

### What to Look For

**🎯 Automatic Pattern Detection**:

- **Cache-related failures**: If >70% of failures occur with cache enabled
- **Environment correlation**: If >80% of failures occur in CI vs local
- **File count differences**: Missing or extra files between success/failure
- **Timing patterns**: Significant duration differences indicating performance issues

**📊 Key Metrics Analyzed**:

- Build success rate over time
- Cache enablement correlation with failures
- File count consistency across builds
- Environment-specific failure patterns
- Error message consistency

**🚨 Critical Findings Auto-Detection**:

- Missing Nx cache directory when cache is enabled
- Significant file count mismatches between success/failure
- Consistent error patterns across multiple failures
- Performance regression detection

### Example Analysis Output

```
🔍 CACHE INVESTIGATION ANALYSIS REPORT
============================================================

📊 BUILD SUMMARY:
  Total Builds: 45
  Successes: 38
  Failures: 7
  Success Rate: 84.4%

🚨 CRITICAL FINDINGS:
  • 6 failure(s) had missing Nx cache directory despite cache being enabled
  • Significant difference in dist file count: Success avg 23.0, Failure avg 18.2

🔍 PATTERN ANALYSIS:
  Cache-related failures: YES
  Environment-related: YES
  File count differences: YES
  Timing-related: NO

💡 RECOMMENDATIONS:
  1. Investigate Nx cache configuration - failures strongly correlate with cache usage
  2. Focus investigation on CI environment differences
  3. Files are missing or extra between successful and failed builds
  4. Check nx.json inputs/outputs configuration for @cedarjs/testing package
```

## Next Steps Based on Findings

### Cache Invalidation Issues

1. Check `nx.json` cache configuration
2. Verify cache input/output definitions
3. Review file change detection patterns
4. Test cache clearing before builds

### Environment Issues

1. Fix critical permission/filesystem problems
2. Standardize CI environment variables
3. Check disk space and memory constraints
4. Verify Node/Yarn/Nx versions

### Timing/Race Conditions

1. Add explicit synchronization between build steps
2. Investigate parallel task execution
3. Check for file system buffering issues
4. Consider sequential task execution

### Configuration Issues

1. Review Nx workspace configuration
2. Check project-specific settings
3. Validate dependency declarations
4. Test with different Nx versions

## Emergency Workarounds

If investigation reveals critical issues that need immediate fixing:

### Temporary: Selective Cache Disabling

```bash
# Disable cache only for problematic packages
yarn nx run-many -t build:pack --exclude create-cedar-app --projects=testing --skipNxCache
```

### Temporary: Explicit Synchronization

```bash
# Add file system sync between steps
yarn nx run-many -t build --exclude create-cedar-app
sync && sleep 2
yarn nx run-many -t build:pack --exclude create-cedar-app
```

## Contact Information

- **Investigation Tools Created By**: AI Assistant
- **Original Issue Context**: Check git history for PR adding `--skipNxCache` flags
- **Nx Documentation**: https://nx.dev/concepts/how-caching-works

## Success Metrics

Investigation is successful if it identifies:

1. **Root cause** of why cache causes failures
2. **Specific actionable fix** to re-enable caching
3. **Verification method** to confirm fix works in CI
4. **Performance improvement** when cache is re-enabled (should be significant)

**Goal**: Remove `--skipNxCache --skipRemoteCache` flags and restore fast, reliable CI builds.

## Troubleshooting the Investigation System

**No reports generated**:

```bash
# Check if investigation is working
cd packages/testing
ls -la .cache-investigation/
```

**Analysis shows no patterns**:

- Need more build data (run more builds)
- May need to manually trigger failures to capture failure data
- Check if cache is actually enabled during CI builds

**CI artifacts not uploading**:

- Check GitHub Actions logs for upload errors
- Verify reports directory exists after build
- May need to adjust artifact upload path
