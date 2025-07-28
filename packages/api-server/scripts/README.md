# API Server Scripts

This directory contains diagnostic and utility scripts for the CedarJS API Server package.

## Timeout Diagnostics

### Overview

The `diagnose-timeouts.mjs` script helps identify and analyze intermittent timeout issues that can occur during server creation, particularly on Windows environments.

### Background

We've observed intermittent timeouts in CI, specifically:

- Occurs primarily on Windows
- Happens during `createServer()` calls in tests
- Manifests as 10-second timeouts in `beforeAll` hooks
- Is sporadic rather than consistent

### Usage

#### Local Development

```bash
# Run basic diagnostics (10 iterations)
yarn diagnose:timeouts

# Run with custom parameters
yarn diagnose:timeouts [iterations] [timeout-ms]

# Examples:
yarn diagnose:timeouts 20 30000 # 20 iterations, 30s timeout
yarn diagnose:timeouts 5 15000  # 5 iterations, 15s timeout
```

#### With Debug Logging

```bash
# Enable detailed logging to see where timeouts occur
CEDAR_DEBUG_TIMEOUT=1 yarn diagnose:timeouts 10
```

#### In CI/CD

The diagnostic script is automatically triggered when:

1. Tests fail on Windows in the main CI workflow
2. Manual execution via the "Diagnose Timeout Issues" workflow

### Script Behavior

The diagnostic script:

1. **Creates multiple server instances** in sequence
2. **Measures timing** for each creation attempt
3. **Detects timeouts** and other errors
4. **Generates a detailed report** with statistics
5. **Provides recommendations** based on findings

### Output

#### Console Output

- Real-time progress for each iteration
- Success/timeout/error status
- Final summary with statistics
- Platform-specific recommendations

#### Report File

- `timeout-diagnostic-report.json` (CI)
- `timeout-diagnostic-TIMESTAMP.json` (local)

Contains:

```json
{
  "metadata": {
    "platform": "win32",
    "nodeVersion": "v20.x.x",
    "iterations": 10,
    "timeoutMs": 30000
  },
  "summary": {
    "successful": 8,
    "timeouts": 2,
    "errors": 0,
    "successRate": 80.0,
    "timeoutRate": 20.0,
    "avgTime": 1250.45,
    "maxTime": 2100.23
  },
  "details": [...]
}
```

### Debug Logging

When `CEDAR_DEBUG_TIMEOUT=1` is set, detailed logs show:

- Server creation steps
- Plugin registration timing
- Function loading progress
- GraphQL import status
- Hook registration timing

Example debug output:

```
[CEDAR_DEBUG] 2024-01-15T10:30:00.000Z - createServer: Starting
[CEDAR_DEBUG] 2024-01-15T10:30:00.100Z - createServer: Options resolved
[CEDAR_DEBUG] 2024-01-15T10:30:00.150Z - redwoodFastifyAPI: Loading functions from dist
[CEDAR_DEBUG] 2024-01-15T10:30:01.200Z - setLambdaFunctions: Import of hello completed
```

### CI Integration

#### Automatic Triggering

The diagnostic runs automatically when tests fail on Windows:

```yaml
- name: 🔍 Diagnose Timeout Issues (Windows)
  if: failure() && matrix.os == 'windows-latest'
  run: yarn diagnose:timeouts 10 30000
```

#### Manual Workflow

Use the "Diagnose Timeout Issues" workflow dispatch to:

- Test specific operating systems
- Adjust iteration count and timeout values
- Enable/disable debug logging
- Run diagnostics on-demand

#### Artifacts

Failed CI runs upload diagnostic reports as artifacts:

- Retention: 30 days
- Name: `timeout-diagnostic-report-{os}-{run-number}`
- Location: GitHub Actions artifacts

### Interpreting Results

#### Success Rate < 100%

- **High timeout rate (>10%)**: Likely environment-specific timing issue
- **Occasional timeouts (<5%)**: May be acceptable, consider increasing timeouts
- **Consistent errors**: Check for configuration or dependency issues

#### Common Patterns

- **Windows timeout clusters**: Often related to file system or port binding
- **Slow function imports**: May indicate disk I/O or module resolution issues
- **GraphQL import hangs**: Check for missing exports or circular dependencies

### Recommendations

#### For Windows Timeout Issues

1. **Increase hook timeout** in `vitest.config.mts`
2. **Check antivirus settings** (real-time scanning can slow file operations)
3. **Verify system resources** (CPU, memory, disk I/O)
4. **Consider retry logic** for CI environments

#### For Consistent Failures

1. **Review debug logs** to identify hanging operations
2. **Check fixture files** for missing exports or imports
3. **Verify test environment** setup and teardown
4. **Monitor resource cleanup** between test iterations

### Troubleshooting

#### Script Won't Run

```bash
# Ensure the package is built
yarn build

# Check Node.js version
node --version

# Verify fixture files exist
ls -la src/__tests__/fixtures/graphql/cedar-app/
```

#### No Report Generated

- Check file permissions in output directory
- Verify script has write access
- Look for uncaught exceptions in console output

#### High Error Rate

- Review error details in console output
- Check test fixture integrity
- Verify all dependencies are installed

### Contributing

When modifying the diagnostic script:

1. **Test locally** on multiple platforms
2. **Verify CI integration** doesn't break existing workflows
3. **Update documentation** for new features or parameters
4. **Add appropriate logging** for new diagnostic points

### Related Files

- `../src/createServer.ts` - Main server creation logic with debug logging
- `../src/plugins/api.ts` - API plugin with debug logging
- `../src/plugins/lambdaLoader.ts` - Function loading with debug logging
- `../vitest.config.mts` - Test configuration with hook timeout
- `../../.github/workflows/ci.yml` - CI integration
- `../../.github/workflows/diagnose-timeouts.yml` - Manual diagnostic workflow
