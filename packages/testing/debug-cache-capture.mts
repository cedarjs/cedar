#!/usr/bin/env tsx

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import ansis from 'ansis'

/**
 * Automatic cache investigation for @cedarjs/testing package
 * Captures build state and environment data on every build to help diagnose intermittent cache issues
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

class CacheInvestigator {
  private packageDir: string
  private reportsDir: string

  constructor() {
    this.packageDir = process.cwd()
    this.reportsDir = path.join(this.packageDir, '.cache-investigation')

    // Ensure reports directory exists
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true })
    }
  }

  async capturePreBuildSnapshot(): Promise<CacheSnapshot> {
    const snapshot: CacheSnapshot = {
      timestamp: new Date().toISOString(),
      nxCacheEnabled:
        !process.env.NX_SKIP_NX_CACHE &&
        !process.argv.includes('--skipNxCache'),
      environment: await this.captureEnvironment(),
      nxCache: await this.captureNxCacheInfo(),
      files: await this.captureFileInfo(),
      buildSuccess: false, // Will be updated post-build
    }

    // Try to get git commit
    try {
      const { execSync } = await import('node:child_process')
      snapshot.gitCommit = execSync('git rev-parse HEAD', {
        encoding: 'utf-8',
      }).trim()
    } catch {
      // Ignore git errors
    }

    return snapshot
  }

  async capturePostBuildSnapshot(
    preBuildSnapshot: CacheSnapshot,
    buildSuccess: boolean,
    buildDuration: number,
    errorMessage?: string,
  ): Promise<CacheSnapshot> {
    const postSnapshot = await this.capturePreBuildSnapshot()

    return {
      ...preBuildSnapshot,
      files: postSnapshot.files, // Update with post-build file state
      buildSuccess,
      buildDuration,
      errorMessage,
    }
  }

  private async captureEnvironment() {
    const isCI = !!(
      process.env.CI ||
      process.env.CONTINUOUS_INTEGRATION ||
      process.env.GITHUB_ACTIONS ||
      process.env.JENKINS_URL
    )

    return {
      nodeVersion: process.version,
      yarnVersion: await this.getYarnVersion(),
      platform: os.platform(),
      arch: os.arch(),
      cwd: process.cwd(),
      ciEnvironment: isCI,
    }
  }

  private async getYarnVersion(): Promise<string> {
    try {
      const { execSync } = await import('node:child_process')
      return execSync('yarn --version', { encoding: 'utf-8' }).trim()
    } catch {
      return 'unknown'
    }
  }

  private async captureNxCacheInfo() {
    const cacheDir = path.resolve('../../.nx/cache')
    const cacheDirExists = fs.existsSync(cacheDir)

    let cacheSize: number | undefined
    let cacheEntries: number | undefined

    if (cacheDirExists) {
      try {
        const entries = fs.readdirSync(cacheDir)
        cacheEntries = entries.length

        // Calculate total cache size
        cacheSize = 0
        for (const entry of entries) {
          try {
            const entryPath = path.join(cacheDir, entry)
            const stats = fs.statSync(entryPath)
            if (stats.isFile()) {
              cacheSize += stats.size
            } else if (stats.isDirectory()) {
              cacheSize += await this.getDirectorySize(entryPath)
            }
          } catch {
            // Skip entries that can't be read
          }
        }
      } catch {
        // Ignore errors reading cache directory
      }
    }

    return {
      cacheDir,
      cacheDirExists,
      cacheSize,
      cacheEntries,
    }
  }

  private async getDirectorySize(dirPath: string): Promise<number> {
    let size = 0
    try {
      const entries = fs.readdirSync(dirPath)
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry)
        const stats = fs.statSync(entryPath)
        if (stats.isFile()) {
          size += stats.size
        } else if (stats.isDirectory()) {
          size += await this.getDirectorySize(entryPath)
        }
      }
    } catch {
      // Ignore errors
    }
    return size
  }

  private async captureFileInfo() {
    return {
      packageJson: this.getFileInfo('package.json'),
      buildScript: this.getFileInfo('build.mts'),
      srcDir: this.getDirectoryInfo('src'),
      distDir: this.getDirectoryInfo('dist'),
      configDir: this.getDirectoryInfo('config'),
    }
  }

  private getFileInfo(filePath: string) {
    const exists = fs.existsSync(filePath)
    if (!exists) {
      return { exists: false }
    }

    try {
      const stats = fs.statSync(filePath)
      return {
        exists: true,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      }
    } catch {
      return { exists: true }
    }
  }

  private getDirectoryInfo(dirPath: string) {
    const exists = fs.existsSync(dirPath)
    if (!exists) {
      return { exists: false }
    }

    try {
      const entries = fs.readdirSync(dirPath, { recursive: true })
      return {
        exists: true,
        fileCount: entries.length,
      }
    } catch {
      return { exists: true }
    }
  }

  async saveSnapshot(snapshot: CacheSnapshot) {
    const filename = `build-${snapshot.timestamp.replace(/[:.]/g, '-')}-${snapshot.buildSuccess ? 'success' : 'failure'}.json`
    const filepath = path.join(this.reportsDir, filename)

    fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2))

    console.log(ansis.cyan(`📊 Cache investigation data saved: ${filepath}`))

    // Also log key information
    this.logSnapshot(snapshot)

    // Check for patterns if we have multiple snapshots
    await this.analyzePatterns()
  }

  private logSnapshot(snapshot: CacheSnapshot) {
    console.log(ansis.blue('\n🔍 Cache Investigation Snapshot:'))
    console.log(`  📅 Timestamp: ${snapshot.timestamp}`)
    console.log(
      `  🎯 Build: ${snapshot.buildSuccess ? ansis.green('SUCCESS') : ansis.red('FAILED')}`,
    )
    console.log(`  ⚡ Duration: ${snapshot.buildDuration || 0}ms`)
    console.log(
      `  🧊 Cache Enabled: ${snapshot.nxCacheEnabled ? ansis.green('YES') : ansis.yellow('NO')}`,
    )
    console.log(
      `  💻 Environment: ${snapshot.environment.platform} ${snapshot.environment.arch} (CI: ${snapshot.environment.ciEnvironment})`,
    )
    console.log(
      `  📁 Cache Dir: ${snapshot.nxCache.cacheDirExists ? ansis.green('EXISTS') : ansis.red('MISSING')} (${snapshot.nxCache.cacheEntries || 0} entries)`,
    )

    if (snapshot.errorMessage) {
      console.log(`  ❌ Error: ${ansis.red(snapshot.errorMessage)}`)
    }

    // Log file counts
    const { files } = snapshot
    console.log(
      `  📄 Files: dist(${files.distDir.exists ? files.distDir.fileCount || 0 : 0}), config(${files.configDir.exists ? files.configDir.fileCount || 0 : 0}), src(${files.srcDir.exists ? files.srcDir.fileCount || 0 : 0})`,
    )
  }

  private async analyzePatterns() {
    try {
      const reportFiles = fs
        .readdirSync(this.reportsDir)
        .filter((f) => f.startsWith('build-') && f.endsWith('.json'))
        .sort()
        .slice(-10) // Keep last 10 reports for analysis

      if (reportFiles.length < 2) {
        return
      }

      const snapshots = reportFiles.map((file) => {
        const content = fs.readFileSync(
          path.join(this.reportsDir, file),
          'utf-8',
        )
        return JSON.parse(content) as CacheSnapshot
      })

      const failures = snapshots.filter((s) => !s.buildSuccess)
      const successes = snapshots.filter((s) => s.buildSuccess)

      if (failures.length > 0 && successes.length > 0) {
        console.log(ansis.yellow('\n🔎 Pattern Analysis:'))
        console.log(
          `  📊 Recent builds: ${successes.length} success, ${failures.length} failures`,
        )

        // Check for cache-related patterns
        const cacheFailures = failures.filter((f) => f.nxCacheEnabled)
        const noCacheFailures = failures.filter((f) => !f.nxCacheEnabled)

        if (cacheFailures.length > 0 && noCacheFailures.length === 0) {
          console.log(
            ansis.red(
              '  🎯 PATTERN: All failures occurred with cache enabled!',
            ),
          )
        }

        // Check environment differences
        const ciFailures = failures.filter((f) => f.environment.ciEnvironment)
        const localFailures = failures.filter(
          (f) => !f.environment.ciEnvironment,
        )

        if (ciFailures.length > 0 && localFailures.length === 0) {
          console.log(
            ansis.yellow(
              '  🎯 PATTERN: All failures occurred in CI environment',
            ),
          )
        }

        // Check for file count differences
        const avgSuccessDistFiles =
          successes.reduce(
            (sum, s) => sum + (s.files.distDir.fileCount || 0),
            0,
          ) / successes.length
        const avgFailureDistFiles =
          failures.reduce(
            (sum, s) => sum + (s.files.distDir.fileCount || 0),
            0,
          ) / failures.length

        if (Math.abs(avgSuccessDistFiles - avgFailureDistFiles) > 2) {
          console.log(
            ansis.yellow(
              `  🎯 PATTERN: File count difference - Success: ${avgSuccessDistFiles.toFixed(1)}, Failure: ${avgFailureDistFiles.toFixed(1)}`,
            ),
          )
        }
      }
    } catch {
      console.log(ansis.gray('  (Pattern analysis failed)'))
    }
  }

  async cleanup() {
    // Keep only the last 20 reports to prevent disk space issues
    try {
      const reportFiles = fs
        .readdirSync(this.reportsDir)
        .filter((f) => f.startsWith('build-') && f.endsWith('.json'))
        .sort()

      if (reportFiles.length > 20) {
        const filesToDelete = reportFiles.slice(0, reportFiles.length - 20)
        for (const file of filesToDelete) {
          fs.unlinkSync(path.join(this.reportsDir, file))
        }
        console.log(
          ansis.gray(
            `🧹 Cleaned up ${filesToDelete.length} old investigation reports`,
          ),
        )
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

export async function capturePreBuild(): Promise<CacheSnapshot> {
  const investigator = new CacheInvestigator()
  return await investigator.capturePreBuildSnapshot()
}

export async function capturePostBuild(
  preBuildSnapshot: CacheSnapshot,
  buildSuccess: boolean,
  buildDuration: number,
  errorMessage?: string,
) {
  const investigator = new CacheInvestigator()
  const finalSnapshot = await investigator.capturePostBuildSnapshot(
    preBuildSnapshot,
    buildSuccess,
    buildDuration,
    errorMessage,
  )
  await investigator.saveSnapshot(finalSnapshot)
  await investigator.cleanup()
}

// If called directly, run a capture
if (import.meta.url === `file://${process.argv[1]}`) {
  const investigator = new CacheInvestigator()
  const snapshot = await investigator.capturePreBuildSnapshot()
  console.log(JSON.stringify(snapshot, null, 2))
}
