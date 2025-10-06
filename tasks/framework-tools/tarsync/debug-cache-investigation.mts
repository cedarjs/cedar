#!/usr/bin/env tsx

import ansis from 'ansis'
import { $, fs, glob, path } from 'zx'

interface FileSnapshot {
  timestamp: string
  files: Record<
    string,
    {
      exists: boolean
      size?: number
      mtime?: string
      checksum?: string
    }
  >
}

interface BuildStep {
  step: string
  timestamp: string
  workingDir: string
  environment: Record<string, string>
  nxState: {
    cacheEnabled: boolean
    cacheDir?: string
    daemonRunning?: boolean
  }
  packageStates: Record<string, FileSnapshot>
  snapshot: FileSnapshot
}

interface InvestigationReport {
  scenario: 'with-cache' | 'without-cache'
  steps: BuildStep[]
  nxLogs: string[]
  finalState: 'success' | 'failure'
  error?: string
  summary?: {
    totalDuration?: number
    keyFindings?: string[]
  }
}

class CacheInvestigator {
  private packagesToMonitor = ['testing', 'project-config', 'auth', 'api']
  private criticalPaths = ['dist', 'config', 'package.json', '*.tgz']

  async investigate(): Promise<void> {
    console.log(ansis.bold.blue('🔍 Cedar Cache Investigation Suite'))
    console.log(
      'This will run builds with and without cache to compare behavior\n',
    )

    // Run both scenarios
    const withCacheReport = await this.runScenario('with-cache')
    const withoutCacheReport = await this.runScenario('without-cache')

    // Compare and analyze
    await this.analyzeReports(withCacheReport, withoutCacheReport)
  }

  private async runScenario(
    scenario: 'with-cache' | 'without-cache',
  ): Promise<InvestigationReport> {
    console.log(ansis.yellow(`\n📋 Running scenario: ${scenario}`))

    const report: InvestigationReport = {
      scenario,
      steps: [],
      nxLogs: [],
      finalState: 'success',
    }

    try {
      // Clean slate
      await this.captureStep(report, 'cleanup', async () => {
        await $`yarn nx reset`
        await $`find ./packages -name "*.tgz" -delete || true`
      })

      // Step 1: Build step
      await this.captureStep(report, 'build', async () => {
        if (scenario === 'with-cache') {
          await $`yarn nx run-many -t build --exclude create-cedar-app --verbose`
        } else {
          await $`yarn nx run-many -t build --exclude create-cedar-app --skipNxCache --skipRemoteCache --verbose`
        }
      })

      // Step 2: Build:pack step
      await this.captureStep(report, 'build:pack', async () => {
        if (scenario === 'with-cache') {
          await $`yarn nx run-many -t build:pack --exclude create-cedar-app --verbose`
        } else {
          await $`yarn nx run-many -t build:pack --exclude create-cedar-app --skipNxCache --skipRemoteCache --verbose`
        }
      })

      report.finalState = 'success'
    } catch (error) {
      report.finalState = 'failure'
      report.error = error instanceof Error ? error.message : String(error)
      console.log(ansis.red(`❌ Scenario ${scenario} failed: ${report.error}`))
    }

    // Calculate total duration from all steps
    const totalDuration = report.steps.reduce((sum, step) => {
      const executionState = step.packageStates['execution']
      if (executionState?.files?.duration?.size) {
        return sum + executionState.files.duration.size
      }
      return sum
    }, 0)

    report.summary = {
      totalDuration,
      keyFindings: [],
    }

    return report
  }

  private async captureStep(
    report: InvestigationReport,
    stepName: string,
    action: () => Promise<void>,
  ): Promise<void> {
    console.log(ansis.cyan(`  🔍 Capturing step: ${stepName}`))

    // Capture snapshot first
    const snapshot = await this.capturePackageState('testing')

    const step: BuildStep = {
      step: stepName,
      timestamp: new Date().toISOString(),
      workingDir: process.cwd(),
      environment: this.captureEnvironment(),
      nxState: await this.captureNxState(report.scenario),
      packageStates: {},
      snapshot,
    }

    // Capture BEFORE state
    for (const pkg of this.packagesToMonitor) {
      step.packageStates[`${pkg}-before`] = await this.capturePackageState(pkg)
    }

    // Execute the action
    const startTime = Date.now()
    try {
      await action()
    } catch (error) {
      step.packageStates['error'] = {
        timestamp: new Date().toISOString(),
        files: { error: { exists: false } },
      }
      throw error
    }
    const duration = Date.now() - startTime

    // Capture AFTER state
    for (const pkg of this.packagesToMonitor) {
      step.packageStates[`${pkg}-after`] = await this.capturePackageState(pkg)
    }

    step.packageStates['execution'] = {
      timestamp: new Date().toISOString(),
      files: {
        duration: { exists: true, size: duration },
        step: { exists: true, size: stepName.length },
      },
    }

    report.steps.push(step)
    console.log(ansis.gray(`    ⏱️  Step completed in ${duration}ms`))
  }

  private async capturePackageState(
    packageName: string,
  ): Promise<FileSnapshot> {
    const snapshot: FileSnapshot = {
      timestamp: new Date().toISOString(),
      files: {},
    }

    const packagePath = `./packages/${packageName}`

    if (!(await fs.pathExists(packagePath))) {
      snapshot.files[`${packageName}-directory`] = { exists: false }
      return snapshot
    }

    // Capture critical paths
    for (const criticalPath of this.criticalPaths) {
      const fullPath = path.join(packagePath, criticalPath)

      try {
        if (criticalPath.includes('*')) {
          // Handle glob patterns
          const matches = await glob([fullPath])
          for (const match of matches) {
            const relativePath = path.relative(packagePath, match)
            const stats = await fs.stat(match)
            snapshot.files[relativePath] = {
              exists: true,
              size: stats.size,
              mtime: stats.mtime.toISOString(),
            }
          }
        } else {
          // Handle direct paths
          if (await fs.pathExists(fullPath)) {
            const stats = await fs.stat(fullPath)

            if (stats.isDirectory()) {
              // For directories, capture file count and some sample files
              const files = await fs.readdir(fullPath, { recursive: true })
              snapshot.files[criticalPath] = {
                exists: true,
                size: files.length,
                mtime: stats.mtime.toISOString(),
              }

              // Sample a few files for deeper inspection
              const sampleFiles = files.slice(0, 5)
              for (const file of sampleFiles) {
                const fileName =
                  typeof file === 'string' ? file : file.toString()
                const filePath = path.join(fullPath, fileName)
                try {
                  const fileStats = await fs.stat(filePath)
                  if (fileStats.isFile()) {
                    snapshot.files[`${criticalPath}/${file}`] = {
                      exists: true,
                      size: fileStats.size,
                      mtime: fileStats.mtime.toISOString(),
                    }
                  }
                } catch {
                  // Skip files that can't be accessed
                }
              }
            } else {
              // Regular file
              snapshot.files[criticalPath] = {
                exists: true,
                size: stats.size,
                mtime: stats.mtime.toISOString(),
              }
            }
          } else {
            snapshot.files[criticalPath] = { exists: false }
          }
        }
      } catch (error) {
        snapshot.files[criticalPath] = {
          exists: false,
          checksum: `error: ${error}`,
        }
      }
    }

    return snapshot
  }

  private captureEnvironment(): Record<string, string> {
    const env: Record<string, string> = {
      CI: process.env.CI || 'undefined',
      NODE_ENV: process.env.NODE_ENV || 'undefined',
      NX_CACHE_DIRECTORY: process.env.NX_CACHE_DIRECTORY || 'undefined',
      NX_CLOUD_ACCESS_TOKEN: process.env.NX_CLOUD_ACCESS_TOKEN || 'undefined',
      NX_SKIP_NX_CACHE: process.env.NX_SKIP_NX_CACHE || 'undefined',
      YARN_CACHE_FOLDER: process.env.YARN_CACHE_FOLDER || 'undefined',
    }

    return env
  }

  private async captureNxState(scenario: 'with-cache' | 'without-cache') {
    const state = {
      cacheEnabled: scenario === 'with-cache',
      cacheDir: undefined as string | undefined,
      daemonRunning: undefined as boolean | undefined,
    }

    try {
      // Check if cache directory exists
      const possibleCacheDirs = [
        '.nx/cache',
        'node_modules/.nx/cache',
        process.env.NX_CACHE_DIRECTORY,
      ].filter(Boolean)

      for (const dir of possibleCacheDirs) {
        if (dir && (await fs.pathExists(dir))) {
          state.cacheDir = dir
          break
        }
      }

      // Try to detect if daemon is running (this might fail, that's ok)
      try {
        const result = await $`yarn nx daemon --status`
        state.daemonRunning = result.stdout.includes('Daemon Server - Running')
      } catch {
        state.daemonRunning = false
      }
    } catch {
      // Nx state capture failed, but that's ok
    }

    return state
  }

  private async analyzeReports(
    withCache: InvestigationReport,
    withoutCache: InvestigationReport,
  ): Promise<void> {
    console.log(ansis.bold.green('\n📊 Analysis Results'))

    // Basic outcome comparison
    console.log(ansis.cyan('\n🎯 Build Outcomes:'))
    console.log(
      `  With cache:    ${withCache.finalState === 'success' ? ansis.green('✅ SUCCESS') : ansis.red('❌ FAILED')}`,
    )
    console.log(
      `  Without cache: ${withoutCache.finalState === 'success' ? ansis.green('✅ SUCCESS') : ansis.red('❌ FAILED')}`,
    )

    if (withCache.finalState !== withoutCache.finalState) {
      console.log(ansis.yellow('\n⚠️  DIFFERENT OUTCOMES DETECTED!'))
      if (withCache.error) {
        console.log(ansis.red(`Cache error: ${withCache.error}`))
      }
      if (withoutCache.error) {
        console.log(ansis.red(`No-cache error: ${withoutCache.error}`))
      }
    }

    // File state comparison
    await this.compareFileStates(withCache, withoutCache)

    // Execution behavior comparison
    await this.compareExecutionBehavior(withCache, withoutCache)

    // Cache-specific analysis
    await this.analyzeCacheBehavior(withCache, withoutCache)

    // Generate summary report
    await this.generateSummaryReport(withCache, withoutCache)
  }

  private async compareFileStates(
    withCache: InvestigationReport,
    withoutCache: InvestigationReport,
  ): Promise<void> {
    console.log(ansis.cyan('\n📁 File State Comparison:'))

    const criticalPackage = 'testing'

    for (const stepName of ['build', 'build:pack']) {
      const cacheStep = withCache.steps.find((s) => s.step === stepName)
      const noCacheStep = withoutCache.steps.find((s) => s.step === stepName)

      if (!cacheStep || !noCacheStep) {
        continue
      }

      console.log(ansis.yellow(`\n  📋 Step: ${stepName}`))

      const cacheAfter = cacheStep.packageStates[`${criticalPackage}-after`]
      const noCacheAfter = noCacheStep.packageStates[`${criticalPackage}-after`]

      if (cacheAfter && noCacheAfter) {
        this.compareSnapshots(cacheAfter, noCacheAfter, `${stepName}-after`)
      }
    }
  }

  private compareSnapshots(
    cache: FileSnapshot,
    noCache: FileSnapshot,
    label: string,
  ): void {
    console.log(ansis.gray(`    🔍 Comparing ${label}:`))

    const allFiles = new Set([
      ...Object.keys(cache.files),
      ...Object.keys(noCache.files),
    ])

    let differences = 0

    for (const fileName of allFiles) {
      const cacheFile = cache.files[fileName]
      const noCacheFile = noCache.files[fileName]

      if (!cacheFile && noCacheFile) {
        console.log(ansis.red(`      ❌ Missing in cache build: ${fileName}`))
        differences++
      } else if (cacheFile && !noCacheFile) {
        console.log(ansis.yellow(`      ⚠️  Extra in cache build: ${fileName}`))
        differences++
      } else if (cacheFile && noCacheFile) {
        if (cacheFile.exists !== noCacheFile.exists) {
          console.log(
            ansis.red(
              `      ❌ Existence differs for ${fileName}: cache=${cacheFile.exists} vs no-cache=${noCacheFile.exists}`,
            ),
          )
          differences++
        } else if (
          cacheFile.exists &&
          noCacheFile.exists &&
          cacheFile.size !== noCacheFile.size
        ) {
          console.log(
            ansis.yellow(
              `      ⚠️  Size differs for ${fileName}: cache=${cacheFile.size} vs no-cache=${noCacheFile.size}`,
            ),
          )
          differences++
        }
      }
    }

    if (differences === 0) {
      console.log(ansis.green(`      ✅ No differences found`))
    } else {
      console.log(ansis.red(`      ❌ Found ${differences} differences`))
    }
  }

  private async compareExecutionBehavior(
    withCache: InvestigationReport,
    withoutCache: InvestigationReport,
  ): Promise<void> {
    console.log(ansis.cyan('\n⚡ Execution Behavior Comparison:'))

    for (
      let i = 0;
      i < Math.max(withCache.steps.length, withoutCache.steps.length);
      i++
    ) {
      const cacheStep = withCache.steps[i]
      const noCacheStep = withoutCache.steps[i]

      if (cacheStep && noCacheStep) {
        console.log(ansis.yellow(`\n  📋 Step: ${cacheStep.step}`))

        const cacheDuration =
          cacheStep.packageStates.execution?.files.duration?.size || 0
        const noCacheDuration =
          noCacheStep.packageStates.execution?.files.duration?.size || 0

        console.log(`    ⏱️  Cache duration: ${cacheDuration}ms`)
        console.log(`    ⏱️  No-cache duration: ${noCacheDuration}ms`)

        if (Math.abs(cacheDuration - noCacheDuration) > 5000) {
          console.log(
            ansis.yellow(
              `    ⚠️  Significant duration difference: ${Math.abs(cacheDuration - noCacheDuration)}ms`,
            ),
          )
        }

        // Compare environment
        const envDiffs = this.compareEnvironments(
          cacheStep.environment,
          noCacheStep.environment,
        )
        if (envDiffs.length > 0) {
          console.log(ansis.yellow(`    ⚠️  Environment differences:`))
          envDiffs.forEach((diff) => console.log(ansis.gray(`      ${diff}`)))
        }
      }
    }
  }

  private compareEnvironments(
    env1: Record<string, string>,
    env2: Record<string, string>,
  ): string[] {
    const differences: string[] = []
    const allKeys = new Set([...Object.keys(env1), ...Object.keys(env2)])

    for (const key of allKeys) {
      if (env1[key] !== env2[key]) {
        differences.push(`${key}: "${env1[key]}" vs "${env2[key]}"`)
      }
    }

    return differences
  }

  private async analyzeCacheBehavior(
    withCache: InvestigationReport,
    withoutCache: InvestigationReport,
  ): Promise<void> {
    console.log(ansis.cyan('\n🗄️  Cache-Specific Analysis:'))

    // Compare cache behavior between scenarios
    console.log(ansis.bold.yellow('\n📊 Cache Behavior Comparison:'))

    const cacheSteps = withCache.steps
    const noCacheSteps = withoutCache.steps

    for (let i = 0; i < Math.max(cacheSteps.length, noCacheSteps.length); i++) {
      const cacheStep = cacheSteps[i]
      const noCacheStep = noCacheSteps[i]

      if (cacheStep && noCacheStep) {
        console.log(ansis.yellow(`\n  📋 Step: ${cacheStep.step}`))

        // Compare cache states
        const cacheEnabled = cacheStep.nxState.cacheEnabled
        const noCacheEnabled = noCacheStep.nxState.cacheEnabled

        if (cacheEnabled !== noCacheEnabled) {
          console.log(ansis.green(`    ✓ Cache setting differs as expected:`))
          console.log(`      With cache: ${cacheEnabled}`)
          console.log(`      Without cache: ${noCacheEnabled}`)
        }

        // Compare cache directories
        const cacheDir = cacheStep.nxState.cacheDir
        const noCacheDir = noCacheStep.nxState.cacheDir

        if (cacheDir !== noCacheDir) {
          console.log(ansis.yellow(`    ⚠️  Cache directory differs:`))
          console.log(`      With cache: ${cacheDir || 'not found'}`)
          console.log(`      Without cache: ${noCacheDir || 'not found'}`)
        }

        // Compare daemon states
        const cacheDaemon = cacheStep.nxState.daemonRunning
        const noCacheDaemon = noCacheStep.nxState.daemonRunning

        if (cacheDaemon !== noCacheDaemon) {
          console.log(ansis.yellow(`    ⚠️  Daemon state differs:`))
          console.log(`      With cache: ${cacheDaemon}`)
          console.log(`      Without cache: ${noCacheDaemon}`)
        }

        // Analyze cache contents if available
        if (cacheDir) {
          try {
            const cacheContents = await fs.readdir(cacheDir)
            console.log(
              `    📁 Cache entries with cache: ${cacheContents.length}`,
            )

            // Sample some cache entries for analysis
            const sampleEntries = cacheContents.slice(0, 3)
            for (const entry of sampleEntries) {
              const entryPath = path.join(cacheDir, entry)
              try {
                const stat = await fs.stat(entryPath)
                console.log(
                  `      - ${entry}: ${stat.isDirectory() ? 'dir' : 'file'} (${stat.size} bytes)`,
                )
              } catch {
                console.log(`      - ${entry}: unable to stat`)
              }
            }
          } catch {
            console.log(`    📁 Cache entries with cache: unable to read`)
          }
        }

        // Compare file states between scenarios
        const cacheFiles = Object.keys(cacheStep.snapshot.files)
        const noCacheFiles = Object.keys(noCacheStep.snapshot.files)

        const missingInCache = noCacheFiles.filter(
          (f) => !cacheFiles.includes(f),
        )
        const extraInCache = cacheFiles.filter((f) => !noCacheFiles.includes(f))

        if (missingInCache.length > 0) {
          console.log(
            ansis.red(
              `    ❌ Files missing in cache scenario: ${missingInCache.length}`,
            ),
          )
          missingInCache.slice(0, 3).forEach((file) => {
            console.log(`      - ${file}`)
          })
        }

        if (extraInCache.length > 0) {
          console.log(
            ansis.blue(
              `    ➕ Extra files in cache scenario: ${extraInCache.length}`,
            ),
          )
          extraInCache.slice(0, 3).forEach((file) => {
            console.log(`      - ${file}`)
          })
        }

        // Compare file contents for common files
        const commonFiles = cacheFiles.filter((f) => noCacheFiles.includes(f))
        let differentFiles = 0

        for (const file of commonFiles.slice(0, 5)) {
          // Check first 5 common files
          const cacheFile = cacheStep.snapshot.files[file]
          const noCacheFile = noCacheStep.snapshot.files[file]

          if (cacheFile.exists && noCacheFile.exists) {
            if (
              cacheFile.size !== noCacheFile.size ||
              cacheFile.mtime !== noCacheFile.mtime ||
              cacheFile.checksum !== noCacheFile.checksum
            ) {
              differentFiles++
            }
          }
        }

        if (differentFiles > 0) {
          console.log(
            ansis.yellow(
              `    ⚠️  Files with different content: ${differentFiles}/${Math.min(commonFiles.length, 5)} sampled`,
            ),
          )
        }
      }
    }

    // Summary of cache impact
    console.log(ansis.bold.cyan('\n📈 Cache Impact Summary:'))

    const withCacheDuration = withCache.summary?.totalDuration || 0
    const withoutCacheDuration = withoutCache.summary?.totalDuration || 0

    if (withCacheDuration && withoutCacheDuration) {
      const speedup = (
        ((withoutCacheDuration - withCacheDuration) / withoutCacheDuration) *
        100
      ).toFixed(1)
      console.log(`  ⏱️  Performance impact: ${speedup}% faster with cache`)
      console.log(`    With cache: ${(withCacheDuration / 1000).toFixed(2)}s`)
      console.log(
        `    Without cache: ${(withoutCacheDuration / 1000).toFixed(2)}s`,
      )
    }
  }

  private async generateSummaryReport(
    withCache: InvestigationReport,
    withoutCache: InvestigationReport,
  ): Promise<void> {
    console.log(ansis.bold.cyan('\n📄 Investigation Summary:'))

    const report = {
      timestamp: new Date().toISOString(),
      withCache: {
        outcome: withCache.finalState,
        error: withCache.error,
        stepCount: withCache.steps.length,
      },
      withoutCache: {
        outcome: withoutCache.finalState,
        error: withoutCache.error,
        stepCount: withoutCache.steps.length,
      },
      keyFindings: [] as string[],
    }

    // Identify key findings
    if (withCache.finalState !== withoutCache.finalState) {
      report.keyFindings.push(
        `Different outcomes: cache ${withCache.finalState} vs no-cache ${withoutCache.finalState}`,
      )
    }

    if (
      withCache.finalState === 'failure' &&
      withoutCache.finalState === 'success'
    ) {
      report.keyFindings.push(
        'Cache causes build failures - this confirms the cache is the problem',
      )
    }

    if (
      withCache.finalState === 'success' &&
      withoutCache.finalState === 'success'
    ) {
      report.keyFindings.push(
        'Both scenarios succeed - need to investigate file differences',
      )
    }

    // Save detailed report
    const reportPath = './cache-investigation-report.json'
    await fs.writeJSON(
      reportPath,
      { withCache, withoutCache, summary: report },
      { spaces: 2 },
    )

    console.log(ansis.green(`\n✅ Investigation complete!`))
    console.log(ansis.gray(`📄 Detailed report saved to: ${reportPath}`))

    // Print key findings
    if (report.keyFindings.length > 0) {
      console.log(ansis.yellow('\n🔍 Key Findings:'))
      report.keyFindings.forEach((finding) => {
        console.log(ansis.yellow(`  • ${finding}`))
      })
    }

    // Print recommendations
    console.log(ansis.cyan('\n💡 Next Steps:'))
    if (
      withCache.finalState === 'failure' &&
      withoutCache.finalState === 'success'
    ) {
      console.log(ansis.cyan('  1. Focus on cache invalidation issues'))
      console.log(ansis.cyan('  2. Check Nx cache configuration'))
      console.log(ansis.cyan('  3. Investigate CI-specific cache behavior'))
    } else {
      console.log(ansis.cyan('  1. Analyze file state differences in detail'))
      console.log(
        ansis.cyan('  2. Check for subtle timing/execution differences'),
      )
      console.log(ansis.cyan('  3. Look for environment-specific behaviors'))
    }
  }
}

async function main() {
  const investigator = new CacheInvestigator()
  await investigator.investigate()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(ansis.red('💥 Investigation failed:'), error)
    process.exit(1)
  })
}
