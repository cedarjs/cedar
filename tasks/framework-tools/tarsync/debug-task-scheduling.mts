#!/usr/bin/env tsx

import ansis from 'ansis'
import { $ } from 'zx'

interface TaskExecution {
  taskId: string
  projectName: string
  targetName: string
  startTime: number
  endTime?: number
  duration?: number
  status: 'running' | 'completed' | 'failed' | 'cached'
  cacheHit: boolean
  dependencies: string[]
  outputs?: string[]
}

interface SchedulingAnalysis {
  scenario: 'with-cache' | 'without-cache'
  totalTasks: number
  parallelTasks: TaskExecution[][]
  taskOrder: string[]
  cacheBehavior: {
    hits: number
    misses: number
    hitRate: number
  }
  timingAnalysis: {
    totalDuration: number
    criticalPath: string[]
    parallelism: number
  }
}

class TaskSchedulingDebugger {
  private taskExecutions = new Map<string, TaskExecution>()
  private executionLog: string[] = []
  private startTime = 0

  async analyzeTaskScheduling(): Promise<void> {
    console.log(ansis.bold.blue('⚡ Nx Task Scheduling Analysis'))
    console.log('Comparing how Nx schedules tasks with and without cache\n')

    const withCacheAnalysis = await this.runSchedulingAnalysis('with-cache')
    const withoutCacheAnalysis =
      await this.runSchedulingAnalysis('without-cache')

    await this.compareSchedulingBehavior(
      withCacheAnalysis,
      withoutCacheAnalysis,
    )
  }

  private async runSchedulingAnalysis(
    scenario: 'with-cache' | 'without-cache',
  ): Promise<SchedulingAnalysis> {
    console.log(ansis.yellow(`\n📊 Analyzing task scheduling: ${scenario}`))

    this.taskExecutions.clear()
    this.executionLog = []
    this.startTime = Date.now()

    // Clean slate
    console.log(ansis.gray('  🧹 Cleaning cache...'))
    await $`yarn nx reset`

    const analysis: SchedulingAnalysis = {
      scenario,
      totalTasks: 0,
      parallelTasks: [],
      taskOrder: [],
      cacheBehavior: { hits: 0, misses: 0, hitRate: 0 },
      timingAnalysis: { totalDuration: 0, criticalPath: [], parallelism: 0 },
    }

    try {
      // First, analyze just the build step
      console.log(ansis.cyan(`  🔨 Running build analysis...`))
      await this.captureTaskExecution(async () => {
        if (scenario === 'with-cache') {
          return await $`yarn nx run-many -t build --exclude create-cedar-app --verbose --parallel=4`
        } else {
          return await $`yarn nx run-many -t build --exclude create-cedar-app --skipNxCache --skipRemoteCache --verbose --parallel=4`
        }
      })

      // Then analyze build:pack step
      console.log(ansis.cyan(`  📦 Running build:pack analysis...`))
      await this.captureTaskExecution(async () => {
        if (scenario === 'with-cache') {
          return await $`yarn nx run-many -t build:pack --exclude create-cedar-app --verbose --parallel=4`
        } else {
          return await $`yarn nx run-many -t build:pack --exclude create-cedar-app --skipNxCache --skipRemoteCache --verbose --parallel=4`
        }
      })

      // Analyze the captured data
      analysis.totalTasks = this.taskExecutions.size
      analysis.taskOrder = Array.from(this.taskExecutions.keys())
      analysis.parallelTasks = this.analyzeParallelExecution()
      analysis.cacheBehavior = this.analyzeCacheBehavior()
      analysis.timingAnalysis = this.analyzeTimingAndCriticalPath()

      console.log(
        ansis.green(
          `  ✅ Analysis complete: ${analysis.totalTasks} tasks analyzed`,
        ),
      )
    } catch (error) {
      console.log(ansis.red(`  ❌ Analysis failed: ${error}`))
    }

    return analysis
  }

  private async captureTaskExecution(
    nxCommand: () => Promise<{ stdout: string; stderr: string }>,
  ): Promise<void> {
    // Start capturing Nx output
    const captureStart = Date.now()

    try {
      // Capture the verbose output to parse task execution
      const result = await nxCommand()
      const combinedOutput = result.stdout + '\n' + result.stderr
      this.executionLog.push(combinedOutput)

      // Parse the actual Nx output
      this.parseNxOutput(combinedOutput, captureStart)
    } catch (error) {
      // Even if the build fails, we want to analyze what happened
      const errorOutput = error.stdout + '\n' + error.stderr
      this.executionLog.push(`ERROR: ${errorOutput}`)
      this.parseNxOutput(errorOutput, captureStart)
    }
  }

  private parseNxOutput(nxOutput: string, captureStart: number): void {
    const lines = nxOutput.split('\n')
    const taskPattern =
      /(?:✔|✓|√|×|✗|Running target|Executing)\s+["']?(\w+[-\w]*):(\w+(?::\w+)?)["']?/
    const cachePattern = /cache hit|cache miss|restored from cache|cached/i
    const timingPattern = /(\d+(?:\.\d+)?)\s*(?:ms|s)/

    let currentTaskId: string | null = null
    let taskStartTime = captureStart

    for (const line of lines) {
      const taskMatch = line.match(taskPattern)

      if (taskMatch) {
        const [, project, target] = taskMatch
        currentTaskId = `${project}:${target}`

        const isCacheHit =
          cachePattern.test(line) &&
          (line.includes('cache hit') || line.includes('restored from cache'))

        const timingMatch = line.match(timingPattern)
        const duration = timingMatch ? parseFloat(timingMatch[1]) : 1000

        const task: TaskExecution = {
          taskId: currentTaskId,
          projectName: project,
          targetName: target,
          startTime: taskStartTime,
          endTime: taskStartTime + duration,
          duration: duration,
          status:
            line.includes('✗') || line.includes('×') ? 'failed' : 'completed',
          cacheHit: isCacheHit,
          dependencies: this.inferDependencies(currentTaskId),
          outputs: [`packages/${project}/dist`],
        }

        this.taskExecutions.set(currentTaskId, task)
        taskStartTime += 50 // Stagger start times
      }
    }

    // If no tasks were parsed from output, fall back to detecting common patterns
    if (this.taskExecutions.size === 0) {
      console.log('No tasks detected from Nx output, using fallback detection')
      this.parseFallbackTasks(captureStart)
    }
  }

  private parseFallbackTasks(captureStart: number): void {
    const commonTasks = [
      'framework-tools:build',
      'project-config:build',
      'auth:build',
      'api:build',
      'testing:build',
      'testing:build:pack',
    ]

    commonTasks.forEach((taskId, index) => {
      const [project, target] = taskId.split(':')
      const task: TaskExecution = {
        taskId,
        projectName: project,
        targetName: target,
        startTime: captureStart + index * 100,
        endTime: captureStart + index * 100 + 1000,
        duration: 1000,
        status: 'completed',
        cacheHit: false, // Conservative assumption for fallback
        dependencies: this.inferDependencies(taskId),
        outputs: [`packages/${project}/dist`],
      }

      this.taskExecutions.set(taskId, task)
    })
  }

  private inferDependencies(taskId: string): string[] {
    const [project, target] = taskId.split(':')

    // Common dependency patterns
    if (target === 'build:pack') {
      return [`${project}:build`]
    }

    if (project === 'testing') {
      return ['framework-tools:build', 'auth:build', 'api:build']
    }

    if (project === 'auth') {
      return ['framework-tools:build']
    }

    return []
  }

  private analyzeParallelExecution(): TaskExecution[][] {
    const tasks = Array.from(this.taskExecutions.values())
    const timeSlots: TaskExecution[][] = []

    // Group tasks that run in parallel (overlapping time windows)
    tasks.sort((a, b) => a.startTime - b.startTime)

    let currentSlot: TaskExecution[] = []
    let currentTimeEnd = 0

    for (const task of tasks) {
      if (task.startTime >= currentTimeEnd) {
        // New time slot
        if (currentSlot.length > 0) {
          timeSlots.push(currentSlot)
        }
        currentSlot = [task]
        currentTimeEnd = task.endTime || task.startTime
      } else {
        // Overlapping - parallel execution
        currentSlot.push(task)
        currentTimeEnd = Math.max(
          currentTimeEnd,
          task.endTime || task.startTime,
        )
      }
    }

    if (currentSlot.length > 0) {
      timeSlots.push(currentSlot)
    }

    return timeSlots
  }

  private analyzeCacheBehavior() {
    const tasks = Array.from(this.taskExecutions.values())
    const hits = tasks.filter((t) => t.cacheHit).length
    const total = tasks.length

    return {
      hits,
      misses: total - hits,
      hitRate: total > 0 ? hits / total : 0,
    }
  }

  private analyzeTimingAndCriticalPath() {
    const tasks = Array.from(this.taskExecutions.values())

    if (tasks.length === 0) {
      return {
        totalDuration: 0,
        criticalPath: [],
        parallelism: 0,
      }
    }

    const startTime = Math.min(...tasks.map((t) => t.startTime))
    const endTime = Math.max(...tasks.map((t) => t.endTime || t.startTime))

    // Calculate average parallelism
    const totalTaskTime = tasks.reduce(
      (sum, task) => sum + (task.duration || 0),
      0,
    )
    const wallClockTime = endTime - startTime
    const parallelism = wallClockTime > 0 ? totalTaskTime / wallClockTime : 0

    // Simple critical path analysis (longest dependency chain)
    const criticalPath = this.findCriticalPath()

    return {
      totalDuration: wallClockTime,
      criticalPath,
      parallelism,
    }
  }

  private findCriticalPath(): string[] {
    // Simplified critical path finding
    const tasks = Array.from(this.taskExecutions.values())

    // Find the task that finishes last
    const lastTask = tasks.reduce((latest, task) => {
      const taskEnd = task.endTime || task.startTime
      const latestEnd = latest.endTime || latest.startTime
      return taskEnd > latestEnd ? task : latest
    })

    // Trace backwards through dependencies
    const path: string[] = []
    let current: TaskExecution | undefined = lastTask

    while (current) {
      path.unshift(current.taskId)

      // Find the dependency that finished latest
      const deps = current.dependencies
        .map((dep) => this.taskExecutions.get(dep))
        .filter(Boolean) as TaskExecution[]

      current =
        deps.reduce(
          (latest, dep) => {
            if (!latest || !dep) {
              return dep || latest
            }
            const depEnd = dep.endTime || dep.startTime
            const latestEnd = latest.endTime || latest.startTime
            return depEnd > latestEnd ? dep : latest
          },
          null as TaskExecution | null,
        ) || undefined
    }

    return path
  }

  private async compareSchedulingBehavior(
    withCache: SchedulingAnalysis,
    withoutCache: SchedulingAnalysis,
  ): Promise<void> {
    console.log(ansis.bold.green('\n📊 Task Scheduling Comparison'))

    // Basic metrics comparison
    console.log(ansis.cyan('\n📈 Execution Metrics:'))
    console.log(
      `  With cache:    ${withCache.totalTasks} tasks, ${withCache.timingAnalysis.totalDuration}ms total`,
    )
    console.log(
      `  Without cache: ${withoutCache.totalTasks} tasks, ${withoutCache.timingAnalysis.totalDuration}ms total`,
    )

    const speedup =
      withoutCache.timingAnalysis.totalDuration /
      withCache.timingAnalysis.totalDuration
    if (speedup > 1.1) {
      console.log(
        ansis.green(`  🚀 Cache provides ${speedup.toFixed(2)}x speedup`),
      )
    } else if (speedup < 0.9) {
      console.log(
        ansis.red(`  🐌 Cache is ${(1 / speedup).toFixed(2)}x slower`),
      )
    } else {
      console.log(
        ansis.yellow(`  ⚖️  Similar performance (${speedup.toFixed(2)}x)`),
      )
    }

    // Parallelism comparison
    console.log(ansis.cyan('\n⚡ Parallelism Analysis:'))
    console.log(
      `  With cache:    ${withCache.timingAnalysis.parallelism.toFixed(2)} avg parallel tasks`,
    )
    console.log(
      `  Without cache: ${withoutCache.timingAnalysis.parallelism.toFixed(2)} avg parallel tasks`,
    )

    if (
      Math.abs(
        withCache.timingAnalysis.parallelism -
          withoutCache.timingAnalysis.parallelism,
      ) > 0.5
    ) {
      console.log(
        ansis.yellow('  ⚠️  Significant parallelism difference detected!'),
      )
    }

    // Cache behavior analysis
    console.log(ansis.cyan('\n🗄️  Cache Behavior:'))
    console.log(
      `  With cache:    ${withCache.cacheBehavior.hits}/${withCache.totalTasks} hits (${(withCache.cacheBehavior.hitRate * 100).toFixed(1)}%)`,
    )
    console.log(
      `  Without cache: ${withoutCache.cacheBehavior.hits}/${withoutCache.totalTasks} hits (${(withoutCache.cacheBehavior.hitRate * 100).toFixed(1)}%)`,
    )

    // Task order comparison
    console.log(ansis.cyan('\n📋 Task Execution Order:'))
    const orderDifferences = this.compareTaskOrder(
      withCache.taskOrder,
      withoutCache.taskOrder,
    )
    if (orderDifferences.length > 0) {
      console.log(ansis.yellow('  ⚠️  Task execution order differs:'))
      orderDifferences.forEach((diff) => {
        console.log(ansis.gray(`    ${diff}`))
      })
    } else {
      console.log(ansis.green('  ✅ Task execution order is identical'))
    }

    // Critical path comparison
    console.log(ansis.cyan('\n🛤️  Critical Path Analysis:'))
    console.log(
      `  With cache:    ${withCache.timingAnalysis.criticalPath.join(' → ')}`,
    )
    console.log(
      `  Without cache: ${withoutCache.timingAnalysis.criticalPath.join(' → ')}`,
    )

    if (
      JSON.stringify(withCache.timingAnalysis.criticalPath) !==
      JSON.stringify(withoutCache.timingAnalysis.criticalPath)
    ) {
      console.log(
        ansis.yellow(
          '  ⚠️  Critical paths differ - this may indicate scheduling changes',
        ),
      )
    }

    // Parallel execution patterns
    this.compareParallelPatterns(withCache, withoutCache)

    // Generate insights
    this.generateSchedulingInsights(withCache, withoutCache)
  }

  private compareTaskOrder(order1: string[], order2: string[]): string[] {
    const differences: string[] = []
    const maxLength = Math.max(order1.length, order2.length)

    for (let i = 0; i < maxLength; i++) {
      const task1 = order1[i]
      const task2 = order2[i]

      if (task1 !== task2) {
        differences.push(`Position ${i}: "${task1}" vs "${task2}"`)
      }
    }

    return differences
  }

  private compareParallelPatterns(
    withCache: SchedulingAnalysis,
    withoutCache: SchedulingAnalysis,
  ): void {
    console.log(ansis.cyan('\n🔀 Parallel Execution Patterns:'))

    console.log(
      `  With cache:    ${withCache.parallelTasks.length} parallel groups`,
    )
    console.log(
      `  Without cache: ${withoutCache.parallelTasks.length} parallel groups`,
    )

    // Compare the structure of parallel execution
    const maxGroups = Math.max(
      withCache.parallelTasks.length,
      withoutCache.parallelTasks.length,
    )

    for (let i = 0; i < Math.min(3, maxGroups); i++) {
      const cacheGroup = withCache.parallelTasks[i] || []
      const noCacheGroup = withoutCache.parallelTasks[i] || []

      console.log(`\n  Group ${i + 1}:`)
      console.log(
        `    With cache:    [${cacheGroup.map((t) => t.taskId).join(', ')}]`,
      )
      console.log(
        `    Without cache: [${noCacheGroup.map((t) => t.taskId).join(', ')}]`,
      )

      if (cacheGroup.length !== noCacheGroup.length) {
        console.log(
          ansis.yellow(
            `    ⚠️  Different parallelism: ${cacheGroup.length} vs ${noCacheGroup.length} tasks`,
          ),
        )
      }
    }
  }

  private generateSchedulingInsights(
    withCache: SchedulingAnalysis,
    withoutCache: SchedulingAnalysis,
  ): void {
    console.log(ansis.bold.cyan('\n💡 Scheduling Insights:'))

    const insights: string[] = []

    // Performance insights
    const performanceDiff =
      withoutCache.timingAnalysis.totalDuration -
      withCache.timingAnalysis.totalDuration
    if (performanceDiff > 5000) {
      insights.push('Cache provides significant performance improvement')
    } else if (performanceDiff < -1000) {
      insights.push('Cache may be causing performance degradation')
    }

    // Parallelism insights
    const parallelismDiff = Math.abs(
      withCache.timingAnalysis.parallelism -
        withoutCache.timingAnalysis.parallelism,
    )
    if (parallelismDiff > 0.5) {
      insights.push('Caching affects task parallelism significantly')
    }

    // Cache hit rate insights
    if (withCache.cacheBehavior.hitRate < 0.3) {
      insights.push('Low cache hit rate - cache may not be effective')
    }

    // Task count insights
    if (withCache.totalTasks !== withoutCache.totalTasks) {
      insights.push(
        'Different number of tasks executed - cache may be skipping/adding work',
      )
    }

    // Execution pattern insights
    if (withCache.parallelTasks.length !== withoutCache.parallelTasks.length) {
      insights.push('Cache changes parallel execution grouping')
    }

    if (insights.length > 0) {
      insights.forEach((insight) => {
        console.log(ansis.yellow(`  • ${insight}`))
      })
    } else {
      console.log(
        ansis.green('  ✅ No significant scheduling differences detected'),
      )
    }

    // Recommendations
    console.log(ansis.bold.cyan('\n🎯 Recommendations:'))

    if (performanceDiff > 5000 && withCache.cacheBehavior.hitRate > 0.7) {
      console.log(
        ansis.green(
          '  ✅ Cache is working well - investigate why it fails in CI',
        ),
      )
    } else if (withCache.cacheBehavior.hitRate < 0.3) {
      console.log(
        ansis.yellow('  ⚠️  Investigate cache invalidation - low hit rate'),
      )
    } else if (parallelismDiff > 1) {
      console.log(
        ansis.yellow(
          '  ⚠️  Cache significantly affects parallelism - may cause race conditions',
        ),
      )
    } else {
      console.log(
        ansis.cyan(
          '  🔍 Focus on file state differences rather than scheduling',
        ),
      )
    }
  }
}

async function main() {
  const schedulingDebugger = new TaskSchedulingDebugger()
  await schedulingDebugger.analyzeTaskScheduling()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(ansis.red('💥 Task scheduling analysis failed:'), error)
    process.exit(1)
  })
}
