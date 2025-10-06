#!/usr/bin/env tsx

import ansis from 'ansis'
import { $ } from 'zx'

/**
 * Master debug coordinator that runs all investigation tools
 * to comprehensively analyze the cache vs no-cache behavior differences
 */

async function runCacheInvestigation() {
  console.log(ansis.bold.blue('🔍 Running Cache Investigation...'))
  try {
    await $`yarn tsx ./tasks/framework-tools/tarsync/debug-cache-investigation.mts`
    console.log(ansis.green('✅ Cache investigation completed'))
  } catch (error) {
    console.log(
      ansis.red('❌ Cache investigation failed:'),
      (error as Error).message,
    )
  }
}

async function runTaskSchedulingAnalysis() {
  console.log(ansis.bold.blue('⚡ Running Task Scheduling Analysis...'))
  try {
    await $`yarn tsx ./tasks/framework-tools/tarsync/debug-task-scheduling.mts`
    console.log(ansis.green('✅ Task scheduling analysis completed'))
  } catch (error) {
    console.log(
      ansis.red('❌ Task scheduling analysis failed:'),
      (error as Error).message,
    )
  }
}

async function runEnvironmentAnalysis() {
  console.log(ansis.bold.blue('🌍 Running Environment Analysis...'))
  try {
    await $`yarn tsx ./tasks/framework-tools/tarsync/debug-env-differences.mts`
    console.log(ansis.green('✅ Environment analysis completed'))
  } catch (error) {
    console.log(
      ansis.red('❌ Environment analysis failed:'),
      (error as Error).message,
    )
  }
}

async function runBasicComparison() {
  console.log(ansis.bold.blue('📊 Running Basic Debug Comparison...'))
  try {
    await $`yarn tsx ./tasks/framework-tools/tarsync/debug-build.mts`
    console.log(ansis.green('✅ Basic debug comparison completed'))
  } catch (error) {
    console.log(
      ansis.red('❌ Basic debug comparison failed:'),
      (error as Error).message,
    )
  }
}

async function generateSummaryReport() {
  console.log(ansis.bold.cyan('\n📋 Generating Summary Report...'))

  const reportFiles = [
    './cache-investigation-report.json',
    './environment-analysis-report.json',
  ]

  const reports: { file: string; content: any }[] = []

  for (const file of reportFiles) {
    try {
      const report = await import(file)
      reports.push({ file, content: report.default || report })
    } catch (error) {
      console.log(
        ansis.yellow(`⚠️  Could not load ${file}: ${(error as Error).message}`),
      )
    }
  }

  console.log(ansis.bold.green('\n🎯 INVESTIGATION SUMMARY'))
  console.log('='.repeat(50))

  console.log(ansis.cyan('\n📊 Analysis Results:'))

  // Check for critical findings across all reports
  const criticalIssues: string[] = []
  const keyFindings: string[] = []

  reports.forEach(({ file, content }) => {
    console.log(ansis.yellow(`\n📄 ${file}:`))

    if (content.summary?.keyFindings) {
      content.summary.keyFindings.forEach((finding: any) => {
        keyFindings.push(`[${file}] ${finding}`)
      })
    }

    if (content.differences) {
      const critical = content.differences.filter(
        (d: any) => d.severity === 'critical',
      )
      critical.forEach((c: any) => {
        criticalIssues.push(`[${file}] ${c.description}`)
      })
    }
  })

  if (criticalIssues.length > 0) {
    console.log(ansis.bold.red('\n🚨 CRITICAL ISSUES FOUND:'))
    criticalIssues.forEach((issue) => {
      console.log(ansis.red(`  • ${issue}`))
    })
  }

  if (keyFindings.length > 0) {
    console.log(ansis.yellow('\n🔍 KEY FINDINGS:'))
    keyFindings.forEach((finding) => {
      console.log(ansis.yellow(`  • ${finding}`))
    })
  }

  console.log(ansis.bold.cyan('\n💡 INVESTIGATION CONCLUSIONS:'))

  if (criticalIssues.length > 0) {
    console.log(
      ansis.red(
        '🎯 Focus on critical issues first - these likely explain the cache problems',
      ),
    )
  } else if (keyFindings.some((f) => f.includes('Different outcomes'))) {
    console.log(
      ansis.yellow(
        '🎯 Cache vs no-cache produces different results - this confirms cache is the issue',
      ),
    )
  } else if (keyFindings.some((f) => f.includes('file differences'))) {
    console.log(
      ansis.cyan(
        '🎯 Files differ between scenarios - investigate Nx cache invalidation',
      ),
    )
  } else {
    console.log(
      ansis.green(
        '🎯 No obvious differences found - may need deeper investigation',
      ),
    )
  }

  console.log(ansis.cyan('\n📋 RECOMMENDED NEXT STEPS:'))
  console.log(ansis.cyan('  1. Review detailed reports for specific issues'))
  console.log(
    ansis.cyan('  2. Focus investigation based on critical/key findings'),
  )
  console.log(
    ansis.cyan('  3. Test specific hypotheses with targeted experiments'),
  )
  console.log(
    ansis.cyan('  4. Consider running investigation in actual CI environment'),
  )

  console.log(ansis.bold.green('\n✅ Master investigation completed!'))
}

async function main() {
  const mode = process.argv[2] || 'all'

  console.log(ansis.bold.green('🚀 Cedar Cache Debug Master'))
  console.log(ansis.gray(`Mode: ${mode}\n`))

  const startTime = Date.now()

  try {
    switch (mode) {
      case 'cache':
        await runCacheInvestigation()
        break

      case 'scheduling':
        await runTaskSchedulingAnalysis()
        break

      case 'environment':
        await runEnvironmentAnalysis()
        break

      case 'basic':
        await runBasicComparison()
        break

      case 'quick':
        console.log(
          ansis.yellow(
            '🏃 Running quick investigation (cache + environment only)',
          ),
        )
        await runCacheInvestigation()
        await runEnvironmentAnalysis()
        await generateSummaryReport()
        break

      case 'all':
      default:
        console.log(ansis.yellow('🔍 Running comprehensive investigation...'))

        // Run all investigations in sequence
        await runBasicComparison()
        console.log('')

        await runCacheInvestigation()
        console.log('')

        await runEnvironmentAnalysis()
        console.log('')

        await runTaskSchedulingAnalysis()
        console.log('')

        // Generate summary
        await generateSummaryReport()
        break
    }

    const duration = Date.now() - startTime
    console.log(
      ansis.green(
        `\n🎉 Investigation completed in ${Math.round(duration / 1000)}s`,
      ),
    )
  } catch (error) {
    console.error(ansis.red('\n💥 Master investigation failed:'), error)
    console.log(ansis.yellow('\n💡 Try running individual tools with:'))
    console.log(
      ansis.gray(
        '  yarn tsx tasks/framework-tools/tarsync/debug-master.mts cache',
      ),
    )
    console.log(
      ansis.gray(
        '  yarn tsx tasks/framework-tools/tarsync/debug-master.mts environment',
      ),
    )
    console.log(
      ansis.gray(
        '  yarn tsx tasks/framework-tools/tarsync/debug-master.mts scheduling',
      ),
    )
    console.log(
      ansis.gray(
        '  yarn tsx tasks/framework-tools/tarsync/debug-master.mts basic',
      ),
    )
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
