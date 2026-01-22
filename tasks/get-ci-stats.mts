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
    `Fetching last ${count} successful runs for workflow '${WORKFLOW_FILE}' ` +
      `on ${branchMsg}...`,
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
      // If first arg is not a number, assume it's a branch?
      // User asked for "Last X runs", so let's stick to count as first priority.
      // But for backward compat with my previous version/flexibility, let's allow it.
      branch = arg1
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
    console.log(
      `Found ${runs.length} runs. Filtering short runs (< 10m) and calculating statistics...`,
    )
    console.log('')

    const MIN_DURATION_MS = 10 * 60 * 1000

    const allStats = runs.map((run) => {
      // run_started_at is more accurate for actual execution time than created_at
      const start = new Date(run.run_started_at || run.created_at).getTime()
      const end = new Date(run.updated_at).getTime()
      const durationMs = end - start

      return {
        id: run.id,
        date: new Date(run.created_at).toLocaleDateString(),
        branch: run.head_branch,
        durationMs,
        durationStr: formatDuration(durationMs),
        conclusion: run.conclusion,
      }
    })

    const stats = allStats
      .filter((run) => run.durationMs >= MIN_DURATION_MS)
      .slice(0, count)

    if (stats.length === 0) {
      console.log(
        `No runs over 10 minutes found in the last ${runs.length} entries.`,
      )
      return
    }

    // Print Table
    console.log(
      `| ${'Date'.padEnd(12)} | ${'Branch'.padEnd(25)} | ${'Duration'.padEnd(10)} | ${'ID'.padEnd(12)} |`,
    )
    console.log(
      `|${'-'.repeat(14)}|${'-'.repeat(27)}|${'-'.repeat(12)}|${'-'.repeat(14)}|`,
    )

    let totalDurationMs = 0
    stats.forEach((run) => {
      totalDurationMs += run.durationMs
      // Truncate branch name if too long
      const branchDisplay =
        run.branch.length > 24
          ? run.branch.substring(0, 21) + '...'
          : run.branch
      console.log(
        `| ${run.date.padEnd(12)} | ${branchDisplay.padEnd(25)} | ${run.durationStr.padEnd(10)} | ${String(run.id).padEnd(12)} |`,
      )
    })

    const averageDurationMs = totalDurationMs / stats.length

    console.log('')
    console.log(`📊 Average Duration: ${formatDuration(averageDurationMs)}`)
    console.log(`(Based on ${stats.length} successful runs)`)
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message)
    } else {
      console.error('Unexpected error:', error)
    }
  }
}

main()
