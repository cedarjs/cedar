import { execSync } from 'node:child_process'

const OWNER = 'cedarjs'
const REPO = 'cedar'
const WORKFLOW_FILE = 'ci.yml'
const DEFAULT_COUNT = 20

/**
 * Gets the GitHub token from the environment or the `gh` CLI.
 */
function getGhToken() {
  if (process.env.GH_TOKEN) {
    return process.env.GH_TOKEN
  }
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN
  }

  try {
    return execSync('gh auth token', { encoding: 'utf-8' }).trim()
  } catch {
    console.error('❌ Error: Could not find GitHub token.')
    console.error(
      'Please set GH_TOKEN environment variable or login with `gh auth login`.',
    )
    process.exit(1)
  }
}

async function fetchWorkflowRuns(
  token: string,
  count: number,
  branch: string | null = null,
): Promise<Record<string, any>[]> {
  let url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?status=success&per_page=${count}`
  let branchMsg = 'all branches'

  if (branch) {
    url += `&branch=${branch}`
    branchMsg = `branch '${branch}'`
  }

  console.log(
    `Fetching successful runs for workflow '${WORKFLOW_FILE}' on ${branchMsg}...`,
  )

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch runs: ${response.status} ${response.statusText}`,
    )
  }

  const data = await response.json()
  return data.workflow_runs
}

async function fetchJobsForRun(
  token: string,
  runId: number,
): Promise<Record<string, any>[]> {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${runId}/jobs?per_page=100`
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch jobs for run ${runId}: ${response.status} ${response.statusText}`,
    )
  }

  const data = await response.json()
  return data.jobs || []
}

function formatDuration(ms: number) {
  const minutes = Math.floor(ms / 60000)
  const seconds = ((ms % 60000) / 1000).toFixed(0)
  return `${minutes}m ${seconds}s`
}

async function main() {
  const token = getGhToken()

  // Arg parsing:
  // node script.mjs [count] [branch]
  let count = DEFAULT_COUNT
  let branch: string | null = null

  const arg1 = process.argv[2]
  const arg2 = process.argv[3]

  if (arg1) {
    const parsedCount = parseInt(arg1, 10)
    if (!isNaN(parsedCount)) {
      count = parsedCount
    } else {
      console.error(`Invalid count: ${arg1}`)
      process.exit(1)
    }

    if (count > 90) {
      // We'll overfetch by 10 to ensure we have enough runs after filtering.
      // GitHub API has a limit of 100 runs per page, so unless we want to add
      // support for pagination, we'll have to limit the count to 90 (90 + 10 =
      // 100).
      console.error(`Count cannot exceed 90`)
      process.exit(1)
    }
  }

  if (arg2) {
    branch = arg2
  }

  try {
    // Overfetch by 10 to ensure we have enough runs after filtering
    const fetchCount = count + 10
    const runs = await fetchWorkflowRuns(token, fetchCount, branch)

    if (!runs || runs.length === 0) {
      console.log('No successful runs found.')
      return
    }

    console.log('')
    console.log(`Filtering short runs(<10m) and calculating statistics...`)
    console.log('')

    const allStats = runs.map((run) => {
      // run_started_at is more accurate for actual execution time than created_at
      const start = new Date(run.run_started_at || run.created_at).getTime()
      const end = new Date(run.updated_at).getTime()
      const durationMs = end - start

      return {
        id: run.id,
        date: new Date(run.created_at).toLocaleDateString(),
        branch: run.head_branch || '(unknown)',
        durationMs,
        durationStr: formatDuration(durationMs),
        conclusion: run.conclusion,
      }
    })

    const minDurationMs = 10 * 60 * 1000

    const stats = allStats
      .filter((run) => run.durationMs >= minDurationMs)
      .slice(0, count)

    if (stats.length === 0) {
      console.log(
        `No runs over 10 minutes found in the last ${runs.length} entries.`,
      )
      return
    }

    // Enrich runs with their longest job information
    console.log('Fetching job details for selected runs...')
    const statsWithJobs = await Promise.all(
      stats.map(async (run) => {
        try {
          const jobs = await fetchJobsForRun(token, run.id)
          let longestJobDurationMs = 0
          let longestJobName = '(unknown)'

          jobs.forEach((job) => {
            if (!job.started_at || !job.completed_at) {
              return
            }
            const started = new Date(job.started_at).getTime()
            const completed = new Date(job.completed_at).getTime()
            if (isNaN(started) || isNaN(completed)) {
              return
            }
            const dur = completed - started
            if (dur > longestJobDurationMs) {
              longestJobDurationMs = dur
              longestJobName = job.name || '(unknown)'
            }
          })

          const longestJobStr =
            longestJobDurationMs > 0
              ? `${formatDuration(longestJobDurationMs)}`
              : '(unknown)'

          return {
            ...run,
            longestJobDurationMs,
            longestJobName,
            longestJobStr,
          }
        } catch (error) {
          console.error(
            `Warning: Could not fetch jobs for run ${run.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
          return {
            ...run,
            longestJobDurationMs: 0,
            longestJobName: '(unknown)',
            longestJobStr: '(unknown)',
          }
        }
      }),
    )

    // Print Table
    console.log(
      `| ${'Date'.padEnd(12)} | ${'Branch'.padEnd(25)} | ${'Duration'.padEnd(10)} | ${'Max Job Duration'.padEnd(16)} | ${'ID'.padEnd(12)} |`,
    )
    console.log(
      `|${'-'.repeat(14)}|${'-'.repeat(27)}|${'-'.repeat(12)}|${'-'.repeat(18)}|${'-'.repeat(14)}|`,
    )

    let totalDurationMs = 0
    let totalLongestJobMs = 0
    let longestJobCount = 0

    statsWithJobs.forEach((run) => {
      totalDurationMs += run.durationMs

      if (run.longestJobDurationMs && run.longestJobDurationMs > 0) {
        totalLongestJobMs += run.longestJobDurationMs
        longestJobCount += 1
      }

      // Truncate branch name if too long
      const branchDisplay =
        run.branch.length > 24
          ? run.branch.substring(0, 21) + '...'
          : run.branch

      // Truncate longest job display if too long
      const longestDisplay =
        run.longestJobStr && run.longestJobStr.length > 16
          ? run.longestJobStr.substring(0, 13) + '...'
          : run.longestJobStr

      console.log(
        `| ${run.date.padEnd(12)} | ${branchDisplay.padEnd(25)} | ${run.durationStr.padEnd(10)} | ${longestDisplay.padEnd(16)} | ${String(run.id).padEnd(12)} |`,
      )
    })

    const averageDurationMs = totalDurationMs / statsWithJobs.length
    const averageLongestJobMs =
      longestJobCount > 0 ? totalLongestJobMs / longestJobCount : 0

    console.log('')
    console.log(`📊 Average Duration: ${formatDuration(averageDurationMs)}`)
    console.log(
      `📊 Average Max Job Duration: ${formatDuration(averageLongestJobMs)}`,
    )
    console.log(
      `(Based on ${statsWithJobs.length} successful runs; ${longestJobCount} runs had job info)`,
    )
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message)
    } else {
      console.error('Unexpected error:', error)
    }
  }
}

main()
