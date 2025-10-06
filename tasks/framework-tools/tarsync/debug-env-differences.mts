#!/usr/bin/env tsx

import ansis from 'ansis'
import { $, fs, os } from 'zx'

interface EnvironmentSnapshot {
  label: string
  timestamp: string
  platform: {
    os: string
    arch: string
    nodeVersion: string
    npmVersion: string
    yarnVersion: string
  }
  environment: {
    ci: boolean
    nodeEnv: string
    nxVariables: Record<string, string>
    yarnVariables: Record<string, string>
    pathVariable: string
    homeDirectory: string
    workingDirectory: string
    tempDirectory: string
  }
  fileSystem: {
    diskSpace: {
      free: number
      total: number
    }
    permissions: {
      canWrite: boolean
      canExecute: boolean
    }
    mountInfo?: string
    fsType?: string
  }
  process: {
    pid: number
    ppid: number
    uid?: number
    gid?: number
    memoryUsage: NodeJS.MemoryUsage
    cpuUsage: NodeJS.CpuUsage
  }
  timing: {
    processUptime: number
    systemUptime?: number
  }
}

interface ExecutionDifference {
  category: 'environment' | 'filesystem' | 'process' | 'timing' | 'platform'
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  withCache: any
  withoutCache: any
  impact: string
}

class EnvironmentDebugger {
  private snapshots = new Map<string, EnvironmentSnapshot>()

  async analyzeEnvironmentDifferences(): Promise<void> {
    console.log(
      ansis.bold.blue('🌍 Environment & Execution Differences Analysis'),
    )
    console.log('Comparing environment state during cache vs no-cache builds\n')

    // Capture baseline environment
    console.log(ansis.cyan('📸 Capturing baseline environment...'))
    const baseline = await this.captureEnvironmentSnapshot('baseline')
    this.snapshots.set('baseline', baseline)

    // Run with cache and capture environment at key points
    console.log(ansis.yellow('\n🗄️  Running with cache enabled...'))
    await this.runWithEnvironmentCapture('with-cache')

    // Run without cache and capture environment at key points
    console.log(ansis.yellow('\n🚫 Running without cache...'))
    await this.runWithEnvironmentCapture('without-cache')

    // Compare and analyze differences
    const differences = await this.compareEnvironments()

    // Generate and save report
    await this.generateReport(differences)
  }

  private async runWithEnvironmentCapture(
    scenario: 'with-cache' | 'without-cache',
  ) {
    try {
      // Clean slate
      await $`yarn nx reset`

      // Capture pre-build environment
      const preBuild = await this.captureEnvironmentSnapshot(
        `${scenario}-pre-build`,
      )
      this.snapshots.set(`${scenario}-pre-build`, preBuild)

      // Run build step
      console.log(ansis.gray(`  🔨 Running build step...`))
      const buildStart = Date.now()

      try {
        if (scenario === 'with-cache') {
          await $`yarn nx run testing:build --verbose`
        } else {
          await $`yarn nx run testing:build --skipNxCache --skipRemoteCache --verbose`
        }
      } catch (error) {
        console.log(ansis.red(`  ❌ Build failed: ${error}`))
      }

      // Capture mid-build environment
      const midBuild = await this.captureEnvironmentSnapshot(
        `${scenario}-mid-build`,
      )
      ;(midBuild.timing as any).buildDuration = Date.now() - buildStart
      this.snapshots.set(`${scenario}-mid-build`, midBuild)

      // Run build:pack step
      console.log(ansis.gray(`  📦 Running build:pack step...`))
      const packStart = Date.now()

      try {
        if (scenario === 'with-cache') {
          await $`yarn nx run testing:build:pack --verbose`
        } else {
          await $`yarn nx run testing:build:pack --skipNxCache --skipRemoteCache --verbose`
        }
      } catch (error) {
        console.log(ansis.red(`  ❌ Build:pack failed: ${error}`))
      }

      // Capture post-build environment
      const postBuild = await this.captureEnvironmentSnapshot(
        `${scenario}-post-build`,
      )
      ;(postBuild.timing as any).packDuration = Date.now() - packStart
      ;(postBuild.timing as any).totalDuration = Date.now() - buildStart
      this.snapshots.set(`${scenario}-post-build`, postBuild)
    } catch (error) {
      console.log(ansis.red(`❌ Scenario ${scenario} failed: ${error}`))
    }
  }

  private async captureEnvironmentSnapshot(
    label: string,
  ): Promise<EnvironmentSnapshot> {
    console.log(ansis.gray(`    📸 Capturing environment snapshot: ${label}`))
    const snapshot: EnvironmentSnapshot = {
      label,
      timestamp: new Date().toISOString(),
      platform: await this.capturePlatformInfo(),
      environment: await this.captureEnvironmentInfo(),
      fileSystem: await this.captureFileSystemInfo(),
      process: await this.captureProcessInfo(),
      timing: await this.captureTimingInfo(),
    }

    return snapshot
  }

  private async capturePlatformInfo() {
    let npmVersion = 'unknown'
    let yarnVersion = 'unknown'

    try {
      npmVersion = (await $`npm --version`).stdout.trim()
    } catch {
      // npm version check failed
    }

    try {
      yarnVersion = (await $`yarn --version`).stdout.trim()
    } catch {
      // yarn version check failed
    }

    return {
      os: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      npmVersion,
      yarnVersion,
    }
  }

  private async captureEnvironmentInfo() {
    const nxVarPrefix = 'NX_'
    const yarnVarPrefix = 'YARN_'

    const nxVariables: Record<string, string> = {}
    const yarnVariables: Record<string, string> = {}

    Object.entries(process.env).forEach(([key, value]) => {
      if (key.startsWith(nxVarPrefix)) {
        nxVariables[key] = value || 'undefined'
      }
      if (key.startsWith(yarnVarPrefix)) {
        yarnVariables[key] = value || 'undefined'
      }
    })

    return {
      ci: process.env.CI === 'true',
      nodeEnv: process.env.NODE_ENV || 'undefined',
      nxVariables,
      yarnVariables,
      pathVariable: process.env.PATH || '',
      homeDirectory: process.env.HOME || process.env.USERPROFILE || '',
      workingDirectory: process.cwd(),
      tempDirectory: os.tmpdir(),
    }
  }

  private async captureFileSystemInfo() {
    const info = {
      diskSpace: { free: 0, total: 0 },
      permissions: { canWrite: false, canExecute: false },
      mountInfo: undefined as string | undefined,
      fsType: undefined as string | undefined,
    }

    try {
      // Cross-platform disk space monitoring
      const platform = os.platform()

      if (platform === 'win32') {
        // Windows: use wmic or PowerShell
        try {
          const result = await $`wmic logicaldisk get size,freespace,caption`
          const lines = result.stdout.trim().split('\n')
          // Parse the current drive info (simplified)
          const currentDrive = process.cwd().charAt(0).toUpperCase()
          for (const line of lines) {
            if (line.includes(currentDrive + ':')) {
              const parts = line.trim().split(/\s+/)
              if (parts.length >= 3) {
                info.diskSpace.free = parseInt(parts[1]) || 0
                info.diskSpace.total = parseInt(parts[2]) || 0
              }
              break
            }
          }
        } catch {
          // Fallback: try PowerShell
          try {
            const psResult =
              await $`powershell "Get-WmiObject -Class Win32_LogicalDisk | Select-Object Size,FreeSpace,DeviceID | ConvertTo-Json"`
            const diskInfo = JSON.parse(psResult.stdout)
            const currentDrive = process.cwd().charAt(0).toUpperCase() + ':'
            const driveInfo = Array.isArray(diskInfo)
              ? diskInfo.find((d) => d.DeviceID === currentDrive)
              : diskInfo.DeviceID === currentDrive
                ? diskInfo
                : null

            if (driveInfo) {
              info.diskSpace.free = parseInt(driveInfo.FreeSpace) || 0
              info.diskSpace.total = parseInt(driveInfo.Size) || 0
            }
          } catch {
            // Windows disk space check failed
          }
        }
      } else {
        // Unix-like systems: use df command
        try {
          const result = await $`df -k .`
          const lines = result.stdout.trim().split('\n')
          if (lines.length >= 2) {
            const stats = lines[1].split(/\s+/)
            if (stats.length >= 4) {
              const totalKB = parseInt(stats[1]) || 0
              const availKB = parseInt(stats[3]) || 0
              info.diskSpace.total = totalKB * 1024 // Convert KB to bytes
              info.diskSpace.free = availKB * 1024
            }
          }
        } catch {
          // df command failed
        }
      }
    } catch {
      // Ignore disk space errors
    }

    try {
      // Check permissions in current directory
      await fs.access('.', fs.constants.W_OK)
      info.permissions.canWrite = true
    } catch {
      // Ignore permission check errors
    }

    try {
      // Check execute permissions
      await fs.access('.', fs.constants.X_OK)
      info.permissions.canExecute = true
    } catch {
      // Ignore execute permission check errors
    }

    try {
      // Try to get mount info (Linux/macOS)
      if (os.platform() !== 'win32') {
        const mountOutput =
          await $`mount | grep ${process.cwd()} || echo "not found"`
        info.mountInfo = mountOutput.stdout.trim()

        // Try to determine filesystem type
        const dfOutput =
          await $`df -T . 2>/dev/null || df . 2>/dev/null || echo "unknown"`
        info.fsType = dfOutput.stdout.trim()
      }
    } catch {
      // Ignore mount info errors
    }

    return info
  }

  private async captureProcessInfo() {
    return {
      pid: process.pid,
      ppid: process.ppid || 0,
      uid: process.getuid ? process.getuid() : undefined,
      gid: process.getgid ? process.getgid() : undefined,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
    }
  }

  private async captureTimingInfo() {
    let systemUptime: number | undefined

    try {
      systemUptime = os.uptime()
    } catch {
      // Ignore timing info errors
    }

    return {
      processUptime: process.uptime(),
      systemUptime,
    }
  }

  private async compareEnvironments(): Promise<ExecutionDifference[]> {
    console.log(ansis.bold.green('\n🔍 Environment Comparison Analysis'))

    const differences: ExecutionDifference[] = []

    // Compare baseline vs execution snapshots
    const withCacheSnapshots = Array.from(this.snapshots.entries()).filter(
      ([key]) => key.startsWith('with-cache'),
    )
    const withoutCacheSnapshots = Array.from(this.snapshots.entries()).filter(
      ([key]) => key.startsWith('without-cache'),
    )

    // Log snapshot summary
    console.log(ansis.cyan(`\n📊 Captured snapshots:`))
    withCacheSnapshots.forEach(([_key, snapshot]) => {
      console.log(`  ✓ ${snapshot.label} (${snapshot.timestamp})`)
    })
    withoutCacheSnapshots.forEach(([_key, snapshot]) => {
      console.log(`  ✓ ${snapshot.label} (${snapshot.timestamp})`)
    })

    // Compare corresponding snapshots
    const phases = ['pre-build', 'mid-build', 'post-build']

    for (const phase of phases) {
      const withCacheSnapshot = this.snapshots.get(`with-cache-${phase}`)
      const withoutCacheSnapshot = this.snapshots.get(`without-cache-${phase}`)

      if (withCacheSnapshot && withoutCacheSnapshot) {
        console.log(ansis.cyan(`\n📊 Comparing ${phase} phase:`))
        const phaseDifferences = this.findDifferences(
          withCacheSnapshot,
          withoutCacheSnapshot,
          phase,
        )
        differences.push(...phaseDifferences)

        this.printPhaseDifferences(phaseDifferences)
      }
    }

    // Overall analysis
    console.log(ansis.bold.cyan('\n📈 Overall Environment Analysis:'))
    this.analyzeOverallDifferences(differences)

    return differences
  }

  private findDifferences(
    withCache: EnvironmentSnapshot,
    withoutCache: EnvironmentSnapshot,
    phase: string,
  ): ExecutionDifference[] {
    const differences: ExecutionDifference[] = []

    // Memory usage differences
    const memDiff =
      withCache.process.memoryUsage.heapUsed -
      withoutCache.process.memoryUsage.heapUsed
    if (Math.abs(memDiff) > 50 * 1024 * 1024) {
      // > 50MB difference
      differences.push({
        category: 'process',
        severity: memDiff > 100 * 1024 * 1024 ? 'high' : 'medium',
        description: `Significant memory usage difference in ${phase}`,
        withCache: withCache.process.memoryUsage.heapUsed,
        withoutCache: withoutCache.process.memoryUsage.heapUsed,
        impact: 'May indicate different execution paths or memory leaks',
      })
    }

    // Disk space differences
    const diskDiff =
      withCache.fileSystem.diskSpace.free -
      withoutCache.fileSystem.diskSpace.free
    if (Math.abs(diskDiff) > 100 * 1024 * 1024) {
      // > 100MB difference
      differences.push({
        category: 'filesystem',
        severity: Math.abs(diskDiff) > 1024 * 1024 * 1024 ? 'high' : 'medium', // 1GB
        description: `Disk space usage difference in ${phase}`,
        withCache: withCache.fileSystem.diskSpace.free,
        withoutCache: withoutCache.fileSystem.diskSpace.free,
        impact: 'May indicate different temporary file creation or cleanup',
      })
    }

    // Process timing differences
    const uptimeDiff =
      withCache.timing.processUptime - withoutCache.timing.processUptime
    if (Math.abs(uptimeDiff) > 5) {
      // > 5 second difference
      differences.push({
        category: 'timing',
        severity: 'low',
        description: `Process uptime difference in ${phase}`,
        withCache: withCache.timing.processUptime,
        withoutCache: withoutCache.timing.processUptime,
        impact: 'May indicate different execution duration',
      })
    }

    // Environment variable differences
    const envDiffs = this.compareObjects(
      withCache.environment.nxVariables,
      withoutCache.environment.nxVariables,
    )
    envDiffs.forEach((diff) => {
      differences.push({
        category: 'environment',
        severity: diff.key.includes('CACHE') ? 'critical' : 'medium',
        description: `Nx environment variable difference: ${diff.key}`,
        withCache: diff.value1,
        withoutCache: diff.value2,
        impact: 'May affect Nx behavior and caching',
      })
    })

    // File system permission differences
    if (
      withCache.fileSystem.permissions.canWrite !==
        withoutCache.fileSystem.permissions.canWrite ||
      withCache.fileSystem.permissions.canExecute !==
        withoutCache.fileSystem.permissions.canExecute
    ) {
      differences.push({
        category: 'filesystem',
        severity: 'critical',
        description: `File system permission difference in ${phase}`,
        withCache: withCache.fileSystem.permissions,
        withoutCache: withoutCache.fileSystem.permissions,
        impact: 'Critical - may prevent file operations',
      })
    }

    return differences
  }

  private compareObjects(obj1: Record<string, any>, obj2: Record<string, any>) {
    const differences: { key: string; value1: any; value2: any }[] = []
    const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)])

    for (const key of allKeys) {
      if (obj1[key] !== obj2[key]) {
        differences.push({ key, value1: obj1[key], value2: obj2[key] })
      }
    }

    return differences
  }

  private printPhaseDifferences(differences: ExecutionDifference[]): void {
    if (differences.length === 0) {
      console.log(ansis.green('  ✅ No significant differences found'))
      return
    }

    differences.forEach((diff) => {
      const severityColor = {
        low: ansis.gray,
        medium: ansis.yellow,
        high: ansis.red,
        critical: ansis.bold.red,
      }[diff.severity]

      console.log(
        severityColor(
          `  ${this.getSeverityIcon(diff.severity)} ${diff.description}`,
        ),
      )
      console.log(
        ansis.gray(`    With cache: ${JSON.stringify(diff.withCache)}`),
      )
      console.log(
        ansis.gray(`    Without cache: ${JSON.stringify(diff.withoutCache)}`),
      )
      console.log(ansis.gray(`    Impact: ${diff.impact}`))
    })
  }

  private getSeverityIcon(severity: string): string {
    switch (severity) {
      case 'low':
        return 'ℹ️'
      case 'medium':
        return '⚠️'
      case 'high':
        return '🚨'
      case 'critical':
        return '💥'
      default:
        return '❓'
    }
  }

  private analyzeOverallDifferences(differences: ExecutionDifference[]): void {
    const bySeverity = differences.reduce(
      (acc, diff) => {
        acc[diff.severity] = (acc[diff.severity] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )

    const byCategory = differences.reduce(
      (acc, diff) => {
        acc[diff.category] = (acc[diff.category] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )

    console.log(`📊 Found ${differences.length} total differences`)
    console.log(`   Severity breakdown: ${JSON.stringify(bySeverity)}`)
    console.log(`   Category breakdown: ${JSON.stringify(byCategory)}`)

    // Critical findings
    const critical = differences.filter((d) => d.severity === 'critical')
    if (critical.length > 0) {
      console.log(
        ansis.bold.red(`\n💥 ${critical.length} CRITICAL differences found:`),
      )
      critical.forEach((diff) => {
        console.log(ansis.red(`   • ${diff.description}`))
      })
    }

    // Key insights
    console.log(ansis.cyan('\n💡 Key Insights:'))

    if (byCategory.environment > 0) {
      console.log(
        ansis.yellow(
          '   • Environment differences detected - may affect Nx behavior',
        ),
      )
    }

    if (byCategory.filesystem > 0) {
      console.log(
        ansis.yellow(
          '   • File system differences detected - may affect build artifacts',
        ),
      )
    }

    if (byCategory.process > 0) {
      console.log(
        ansis.yellow(
          '   • Process differences detected - may indicate different execution paths',
        ),
      )
    }

    if (differences.length === 0) {
      console.log(
        ansis.green(
          '   ✅ Environment is consistent between cache and no-cache scenarios',
        ),
      )
      console.log(
        ansis.cyan(
          '   🔍 Focus investigation on Nx internals and file state differences',
        ),
      )
    }
  }

  private async generateEnvironmentReport(
    differences: ExecutionDifference[],
  ): Promise<void> {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalDifferences: differences.length,
        bySeverity: differences.reduce(
          (acc, d) => {
            acc[d.severity] = (acc[d.severity] || 0) + 1
            return acc
          },
          {} as Record<string, number>,
        ),
        byCategory: differences.reduce(
          (acc, d) => {
            acc[d.category] = (acc[d.category] || 0) + 1
            return acc
          },
          {} as Record<string, number>,
        ),
      },
      snapshots: Object.fromEntries(this.snapshots),
      differences,
      recommendations: this.generateRecommendations(differences),
    }

    const reportPath = './environment-analysis-report.json'
    await fs.writeJSON(reportPath, report, { spaces: 2 })

    console.log(
      ansis.green(`\n📄 Detailed environment report saved to: ${reportPath}`),
    )
  }

  private generateRecommendations(
    differences: ExecutionDifference[],
  ): string[] {
    const recommendations: string[] = []

    const critical = differences.filter((d) => d.severity === 'critical')
    if (critical.length > 0) {
      recommendations.push(
        'URGENT: Address critical environment differences first',
      )
      critical.forEach((diff) => {
        recommendations.push(`- Fix: ${diff.description}`)
      })
    }

    const envDiffs = differences.filter((d) => d.category === 'environment')
    if (envDiffs.length > 0) {
      recommendations.push(
        'Review Nx configuration and environment variable handling',
      )
    }

    const fsDiffs = differences.filter((d) => d.category === 'filesystem')
    if (fsDiffs.length > 0) {
      recommendations.push(
        'Investigate file system permissions and disk usage patterns',
      )
    }

    if (differences.length === 0) {
      recommendations.push(
        'Environment is consistent - focus on Nx task execution and file state analysis',
      )
    }

    return recommendations
  }

  private async generateReport(
    differences: ExecutionDifference[],
  ): Promise<void> {
    console.log(ansis.cyan('\n📄 Generating environment analysis report...'))

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalDifferences: differences.length,
        criticalDifferences: differences.filter(
          (d) => d.severity === 'critical',
        ).length,
        highDifferences: differences.filter((d) => d.severity === 'high')
          .length,
        mediumDifferences: differences.filter((d) => d.severity === 'medium')
          .length,
        lowDifferences: differences.filter((d) => d.severity === 'low').length,
        categories: {
          environment: differences.filter((d) => d.category === 'environment')
            .length,
          filesystem: differences.filter((d) => d.category === 'filesystem')
            .length,
          process: differences.filter((d) => d.category === 'process').length,
          timing: differences.filter((d) => d.category === 'timing').length,
          platform: differences.filter((d) => d.category === 'platform').length,
        },
        keyFindings: differences
          .filter((d) => d.severity === 'critical' || d.severity === 'high')
          .map((d) => d.description)
          .slice(0, 5), // Top 5 critical findings
      },
      differences,
      snapshots: Object.fromEntries(this.snapshots.entries()),
      recommendations: this.generateRecommendations(differences),
    }

    try {
      await fs.writeFile(
        './environment-analysis-report.json',
        JSON.stringify(report, null, 2),
      )
      console.log(
        ansis.green(
          '✅ Environment analysis report saved to environment-analysis-report.json',
        ),
      )
    } catch (error) {
      console.log(ansis.red('❌ Failed to save environment report:'), error)
    }
  }
}

async function main() {
  const envDebugger = new EnvironmentDebugger()
  await envDebugger.analyzeEnvironmentDifferences()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(ansis.red('💥 Environment analysis failed:'), error)
    process.exit(1)
  })
}
