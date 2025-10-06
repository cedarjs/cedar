#!/usr/bin/env tsx

import fs from 'node:fs'
import path from 'node:path'

import ansis from 'ansis'

/**
 * Analyze cache investigation reports to identify patterns in intermittent build failures
 */

interface CacheSnapshot {
  timestamp: string
  gitCommit?: string
  nxCacheEnabled: boolean
  environment: {
    nodeVersion: string
    yarnVersion: string
    platform: string
    arch: string
    cwd: string
    ciEnvironment: boolean
  }
  nxCache: {
    cacheDir: string
    cacheDirExists: boolean
    cacheSize?: number
    cacheEntries?: number
  }
  files: {
    packageJson: {
      exists: boolean
      size?: number
      modified?: string
    }
    buildScript: {
      exists: boolean
      size?: number
      modified?: string
    }
    srcDir: {
      exists: boolean
      fileCount?: number
    }
    distDir: {
      exists: boolean
      fileCount?: number
    }
    configDir: {
      exists: boolean
      fileCount?: number
    }
  }
  buildSuccess: boolean
  buildDuration?: number
  errorMessage?: string
}

interface AnalysisReport {
  totalBuilds: number
  successCount: number
  failureCount: number
  successRate: string
  patterns: {
    cacheRelated: boolean
    environmentRelated: boolean
    fileCountDifferences: boolean
    timingRelated: boolean
  }
  recommendations: string[]
  criticalFindings: string[]
}

class CacheReportAnalyzer {
  private reportsDir: string
  private snapshots: CacheSnapshot[] = []

  constructor() {
    this.reportsDir = path.join(process.cwd(), '.cache-investigation')
  }

  async loadReports(): Promise<void> {
    if (!fs.existsSync(this.reportsDir)) {
      console.log(ansis.yellow('⚠️  No cache investigation reports found'))
      console.log(ansis.gray(`    Expected directory: ${this.reportsDir}`))
      return
    }

    const reportFiles = fs
      .readdirSync(this.reportsDir)
      .filter((f) => f.startsWith('build-') && f.endsWith('.json'))
      .sort()

    if (reportFiles.length === 0) {
      console.log(
        ansis.yellow(
          '⚠️  No build reports found in cache investigation directory',
        ),
      )
      return
    }

    console.log(
      ansis.blue(
        `🔍 Loading ${reportFiles.length} cache investigation reports...`,
      ),
    )

    for (const file of reportFiles) {
      try {
        const content = fs.readFileSync(
          path.join(this.reportsDir, file),
          'utf-8',
        )
        const snapshot = JSON.parse(content) as CacheSnapshot
        this.snapshots.push(snapshot)
      } catch (error) {
        console.log(ansis.yellow(`⚠️  Failed to load ${file}: ${error}`))
      }
    }

    console.log(
      ansis.green(`✅ Loaded ${this.snapshots.length} reports successfully\n`),
    )
  }

  analyze(): AnalysisReport {
    const failures = this.snapshots.filter((s) => !s.buildSuccess)
    const successes = this.snapshots.filter((s) => s.buildSuccess)

    const successRate =
      this.snapshots.length > 0
        ? ((successes.length / this.snapshots.length) * 100).toFixed(1)
        : '0.0'

    const patterns = {
      cacheRelated: this.detectCachePatterns(successes, failures),
      environmentRelated: this.detectEnvironmentPatterns(successes, failures),
      fileCountDifferences: this.detectFileCountPatterns(successes, failures),
      timingRelated: this.detectTimingPatterns(successes, failures),
    }

    const recommendations = this.generateRecommendations(
      patterns,
      successes,
      failures,
    )
    const criticalFindings = this.findCriticalFindings(successes, failures)

    return {
      totalBuilds: this.snapshots.length,
      successCount: successes.length,
      failureCount: failures.length,
      successRate: `${successRate}%`,
      patterns,
      recommendations,
      criticalFindings,
    }
  }

  private detectCachePatterns(
    successes: CacheSnapshot[],
    failures: CacheSnapshot[],
  ): boolean {
    // Check if failures correlate with cache usage
    const cacheFailures = failures.filter((f) => f.nxCacheEnabled)
    const noCacheFailures = failures.filter((f) => !f.nxCacheEnabled)

    const cacheSuccesses = successes.filter((s) => s.nxCacheEnabled)
    const noCacheSuccesses = successes.filter((s) => !s.nxCacheEnabled)

    // Strong signal: ALL failures occur with cache enabled
    if (failures.length > 0 && noCacheFailures.length === 0) {
      return true
    }

    // Stronger signal: Cache works for successes but fails for failures
    if (
      successes.length > 0 &&
      cacheSuccesses.length > 0 &&
      failures.length > 0 &&
      cacheFailures.length > 0 &&
      noCacheSuccesses.length === 0 &&
      noCacheFailures.length > 0
    ) {
      return true
    }

    // If significantly more failures occur with cache enabled
    return (
      cacheFailures.length > 0 && cacheFailures.length / failures.length > 0.7
    )
  }

  private detectEnvironmentPatterns(
    successes: CacheSnapshot[],
    failures: CacheSnapshot[],
  ): boolean {
    // Check if failures correlate with specific environments
    const ciFailures = failures.filter((f) => f.environment.ciEnvironment)
    const localFailures = failures.filter((f) => !f.environment.ciEnvironment)

    const ciSuccesses = successes.filter((s) => s.environment.ciEnvironment)
    const localSuccesses = successes.filter((s) => !s.environment.ciEnvironment)

    // Strong signal: ALL failures occur in CI only
    if (failures.length > 0 && localFailures.length === 0) {
      return true
    }

    // Strong signal: ALL failures occur locally only
    if (failures.length > 0 && ciFailures.length === 0) {
      return true
    }

    // Pattern: Successes in one env, failures in another
    if (successes.length > 0 && failures.length > 0) {
      if (
        ciSuccesses.length > 0 &&
        localFailures.length > 0 &&
        localSuccesses.length === 0 &&
        ciFailures.length === 0
      ) {
        return true // Successes only in CI, failures only local
      }
      if (
        localSuccesses.length > 0 &&
        ciFailures.length > 0 &&
        ciSuccesses.length === 0 &&
        localFailures.length === 0
      ) {
        return true // Successes only local, failures only in CI
      }
    }

    // If significantly more failures occur in CI
    return ciFailures.length > 0 && ciFailures.length / failures.length > 0.8
  }

  private detectFileCountPatterns(
    successes: CacheSnapshot[],
    failures: CacheSnapshot[],
  ): boolean {
    if (successes.length === 0 || failures.length === 0) {
      return false
    }

    const avgSuccessFiles = this.getAverageFileCount(successes)
    const avgFailureFiles = this.getAverageFileCount(failures)

    // Significant difference in file counts
    return (
      Math.abs(avgSuccessFiles.dist - avgFailureFiles.dist) > 2 ||
      Math.abs(avgSuccessFiles.config - avgFailureFiles.config) > 2
    )
  }

  private detectTimingPatterns(
    successes: CacheSnapshot[],
    failures: CacheSnapshot[],
  ): boolean {
    if (successes.length === 0 || failures.length === 0) {
      return false
    }

    const successesWithDuration = successes.filter((s) => s.buildDuration)
    const avgSuccessTime =
      successesWithDuration.length > 0
        ? successesWithDuration.reduce(
            (sum, s) => sum + (s.buildDuration || 0),
            0,
          ) / successesWithDuration.length
        : 0

    const failuresWithDuration = failures.filter((f) => f.buildDuration)
    const avgFailureTime =
      failuresWithDuration.length > 0
        ? failuresWithDuration.reduce(
            (sum, f) => sum + (f.buildDuration || 0),
            0,
          ) / failuresWithDuration.length
        : 0

    // Significant timing difference (failures taking much longer might indicate cache issues)
    return (
      avgFailureTime > 0 &&
      avgSuccessTime > 0 &&
      avgFailureTime / avgSuccessTime > 2
    )
  }

  private getAverageFileCount(snapshots: CacheSnapshot[]) {
    const totals = snapshots.reduce(
      (acc, s) => ({
        dist: acc.dist + (s.files.distDir.fileCount || 0),
        config: acc.config + (s.files.configDir.fileCount || 0),
        src: acc.src + (s.files.srcDir.fileCount || 0),
      }),
      { dist: 0, config: 0, src: 0 },
    )

    const count = snapshots.length || 1
    return {
      dist: totals.dist / count,
      config: totals.config / count,
      src: totals.src / count,
    }
  }

  private generateRecommendations(
    patterns: AnalysisReport['patterns'],
    successes: CacheSnapshot[],
    failures: CacheSnapshot[],
  ): string[] {
    const recommendations: string[] = []

    if (patterns.cacheRelated) {
      const noCacheFailures = failures.filter((f) => !f.nxCacheEnabled)
      const cacheSuccesses = successes.filter((s) => s.nxCacheEnabled)
      const noCacheSuccesses = successes.filter((s) => !s.nxCacheEnabled)

      if (noCacheFailures.length === 0 && failures.length > 0) {
        if (cacheSuccesses.length > 0) {
          recommendations.push(
            'CRITICAL: Cache works for successes but ALL failures occur with cache - investigate cache corruption/invalidation',
          )
        } else {
          recommendations.push(
            'CRITICAL: ALL failures occur only when cache is enabled - cache is definitely the root cause',
          )
        }
      } else if (
        noCacheSuccesses.length > 0 &&
        cacheSuccesses.length === 0 &&
        failures.length > 0
      ) {
        recommendations.push(
          'PATTERN: Successes without cache, failures with cache - cache is corrupting builds',
        )
      } else {
        recommendations.push(
          'Investigate Nx cache configuration - failures strongly correlate with cache usage',
        )
      }
      recommendations.push(
        'Try running builds with --skipNxCache flag to confirm cache is the issue',
      )
      recommendations.push(
        'Check nx.json inputs/outputs configuration for @cedarjs/testing package',
      )
    }

    if (patterns.environmentRelated) {
      const ciFailures = failures.filter((f) => f.environment.ciEnvironment)
      const localFailures = failures.filter((f) => !f.environment.ciEnvironment)
      const ciSuccesses = successes.filter((s) => s.environment.ciEnvironment)
      const localSuccesses = successes.filter(
        (s) => !s.environment.ciEnvironment,
      )

      if (localFailures.length === 0 && failures.length > 0) {
        recommendations.push(
          'CRITICAL: ALL failures occur only in CI - focus on CI environment',
        )
      } else if (ciFailures.length === 0 && failures.length > 0) {
        recommendations.push(
          'CRITICAL: ALL failures occur only locally - check local environment setup',
        )
      } else if (
        ciSuccesses.length > 0 &&
        localFailures.length > 0 &&
        localSuccesses.length === 0 &&
        ciFailures.length === 0
      ) {
        recommendations.push(
          'PATTERN: Builds succeed in CI but fail locally - check local development environment',
        )
      } else if (
        localSuccesses.length > 0 &&
        ciFailures.length > 0 &&
        ciSuccesses.length === 0 &&
        localFailures.length === 0
      ) {
        recommendations.push(
          'PATTERN: Builds succeed locally but fail in CI - focus on CI configuration differences',
        )
      } else {
        recommendations.push(
          'Focus investigation on CI environment differences',
        )
      }
      recommendations.push(
        'Compare file permissions, disk performance, and parallel execution in CI vs local',
      )
      recommendations.push(
        'Check if CI runners have different filesystem characteristics',
      )
    }

    if (patterns.fileCountDifferences) {
      recommendations.push(
        'Files are missing or extra between successful and failed builds',
      )
      recommendations.push(
        'Investigate build process race conditions or incomplete cache restoration',
      )
      recommendations.push(
        'Check if parallel builds are interfering with each other',
      )
    }

    if (patterns.timingRelated) {
      recommendations.push(
        'Build timing differences suggest performance or blocking issues',
      )
      recommendations.push('Profile build steps to identify bottlenecks')
      recommendations.push('Check for resource contention or I/O blocking')
    }

    if (failures.length > 0) {
      const hasErrorMessages = failures.some((f) => f.errorMessage)
      if (hasErrorMessages) {
        recommendations.push(
          'Review specific error messages in failed builds for clues',
        )
      }
    }

    if (recommendations.length === 0) {
      recommendations.push(
        'No clear patterns detected - consider running more builds to gather more data',
      )
      recommendations.push('Try manually reproducing the failure conditions')
      recommendations.push('Enable more verbose logging during builds')
    }

    return recommendations
  }

  private findCriticalFindings(
    successes: CacheSnapshot[],
    failures: CacheSnapshot[],
  ): string[] {
    const findings: string[] = []

    // Cache-related critical findings
    const noCacheFailures = failures.filter((f) => !f.nxCacheEnabled)
    const cacheSuccesses = successes.filter((s) => s.nxCacheEnabled)

    if (failures.length > 0 && noCacheFailures.length === 0) {
      if (cacheSuccesses.length > 0) {
        findings.push(
          'CRITICAL: Cache works for successes but 100% of failures occur with cache enabled - cache corruption/race condition likely',
        )
      } else {
        findings.push(
          'CRITICAL: 100% of failures occur with cache enabled - cache is the root cause',
        )
      }
    }

    // Cache directory issues
    const cacheFailures = failures.filter(
      (f) => f.nxCacheEnabled && !f.nxCache.cacheDirExists,
    )
    if (cacheFailures.length > 0) {
      findings.push(
        `${cacheFailures.length} failure(s) had missing Nx cache directory despite cache being enabled`,
      )
    }

    // Environment-related critical findings
    const ciFailures = failures.filter((f) => f.environment.ciEnvironment)
    const localFailures = failures.filter((f) => !f.environment.ciEnvironment)

    if (failures.length > 0 && localFailures.length === 0) {
      findings.push('CRITICAL: 100% of failures occur in CI environment only')
    } else if (failures.length > 0 && ciFailures.length === 0) {
      findings.push(
        'CRITICAL: 100% of failures occur in local environment only',
      )
    }

    // File count mismatches
    if (successes.length > 0 && failures.length > 0) {
      const successFiles = this.getAverageFileCount(successes)
      const failureFiles = this.getAverageFileCount(failures)

      if (Math.abs(successFiles.dist - failureFiles.dist) > 5) {
        findings.push(
          `Significant difference in dist file count: Success avg ${successFiles.dist.toFixed(1)}, Failure avg ${failureFiles.dist.toFixed(1)}`,
        )
      }

      if (Math.abs(successFiles.config - failureFiles.config) > 2) {
        findings.push(
          `Config file count differs: Success avg ${successFiles.config.toFixed(1)}, Failure avg ${failureFiles.config.toFixed(1)}`,
        )
      }
    }

    // Consistent error patterns
    const errorMessages = failures.map((f) => f.errorMessage).filter(Boolean)
    const uniqueErrors = [...new Set(errorMessages)]
    if (uniqueErrors.length === 1 && failures.length > 1) {
      findings.push(`All failures have same error: "${uniqueErrors[0]}"`)
    }

    return findings
  }

  printReport(): void {
    if (this.snapshots.length === 0) {
      console.log(ansis.yellow('No cache investigation data to analyze'))
      return
    }

    const analysis = this.analyze()

    console.log(ansis.bold.blue('🔍 CACHE INVESTIGATION ANALYSIS REPORT'))
    console.log('='.repeat(60))

    // Summary
    console.log(ansis.cyan('\n📊 BUILD SUMMARY:'))
    console.log(`  Total Builds: ${analysis.totalBuilds}`)
    console.log(`  Successes: ${ansis.green(analysis.successCount)}`)
    console.log(`  Failures: ${ansis.red(analysis.failureCount)}`)
    console.log(`  Success Rate: ${analysis.successRate}`)

    // Time range
    if (this.snapshots.length > 0) {
      const oldest = this.snapshots[0].timestamp
      const newest = this.snapshots[this.snapshots.length - 1].timestamp
      console.log(`  Time Range: ${oldest} to ${newest}`)
    }

    // Critical findings
    if (analysis.criticalFindings.length > 0) {
      console.log(ansis.bold.red('\n🚨 CRITICAL FINDINGS:'))
      analysis.criticalFindings.forEach((finding) => {
        console.log(ansis.red(`  • ${finding}`))
      })
    }

    // Pattern detection
    console.log(ansis.yellow('\n🔍 PATTERN ANALYSIS:'))
    console.log(
      `  Cache-related failures: ${analysis.patterns.cacheRelated ? ansis.red('YES') : ansis.green('NO')}`,
    )
    console.log(
      `  Environment-related: ${analysis.patterns.environmentRelated ? ansis.red('YES') : ansis.green('NO')}`,
    )
    console.log(
      `  File count differences: ${analysis.patterns.fileCountDifferences ? ansis.red('YES') : ansis.green('NO')}`,
    )
    console.log(
      `  Timing-related: ${analysis.patterns.timingRelated ? ansis.red('YES') : ansis.green('NO')}`,
    )

    // Recommendations
    console.log(ansis.cyan('\n💡 RECOMMENDATIONS:'))
    analysis.recommendations.forEach((rec, i) => {
      console.log(ansis.cyan(`  ${i + 1}. ${rec}`))
    })

    // Detailed breakdown
    if (analysis.failureCount > 0) {
      console.log(ansis.gray('\n📋 FAILURE BREAKDOWN:'))
      const failures = this.snapshots.filter((s) => !s.buildSuccess)

      const cacheFailures = failures.filter((f) => f.nxCacheEnabled).length
      const noCacheFailures = failures.filter((f) => !f.nxCacheEnabled).length

      const cacheColor = noCacheFailures === 0 ? ansis.red : ansis.white
      console.log(`  With cache enabled: ${cacheColor(cacheFailures)}`)
      console.log(`  With cache disabled: ${noCacheFailures}`)

      if (noCacheFailures === 0 && failures.length > 0) {
        console.log(ansis.red('    → ALL failures are cache-related!'))
      }

      const ciFailures = failures.filter(
        (f) => f.environment.ciEnvironment,
      ).length
      const localFailures = failures.filter(
        (f) => !f.environment.ciEnvironment,
      ).length

      const envColor =
        localFailures === 0 || ciFailures === 0 ? ansis.red : ansis.white
      console.log(`  In CI environment: ${envColor(ciFailures)}`)
      console.log(`  In local environment: ${envColor(localFailures)}`)

      if (localFailures === 0 && failures.length > 0) {
        console.log(ansis.red('    → ALL failures are CI-specific!'))
      } else if (ciFailures === 0 && failures.length > 0) {
        console.log(ansis.red('    → ALL failures are local-only!'))
      }
    }

    console.log(ansis.green('\n✅ Analysis complete'))
    console.log(ansis.gray(`Reports directory: ${this.reportsDir}`))
  }

  printDetailedHistory(): void {
    if (this.snapshots.length === 0) {
      return
    }

    console.log(ansis.bold.blue('\n📈 BUILD HISTORY (Last 20):'))
    console.log('-'.repeat(100))

    const recent = this.snapshots.slice(-20)

    recent.forEach((snapshot) => {
      const status = snapshot.buildSuccess ? ansis.green('✓') : ansis.red('✗')
      const cache = snapshot.nxCacheEnabled ? 'CACHE' : 'NO-CACHE'
      const env = snapshot.environment.ciEnvironment ? 'CI' : 'LOCAL'
      const duration = snapshot.buildDuration
        ? `${snapshot.buildDuration}ms`
        : 'N/A'
      const timestamp = new Date(snapshot.timestamp).toLocaleString()

      console.log(`${status} ${timestamp} [${cache}] [${env}] ${duration}`)

      if (!snapshot.buildSuccess && snapshot.errorMessage) {
        console.log(
          ansis.red(`    Error: ${snapshot.errorMessage.slice(0, 80)}...`),
        )
      }
    })
  }
}

async function main() {
  const mode = process.argv[2] || 'summary'
  const analyzer = new CacheReportAnalyzer()

  await analyzer.loadReports()

  switch (mode) {
    case 'detailed':
    case 'detail':
      analyzer.printReport()
      analyzer.printDetailedHistory()
      break

    case 'history':
      analyzer.printDetailedHistory()
      break

    case 'summary':
    default:
      analyzer.printReport()
      break
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}
