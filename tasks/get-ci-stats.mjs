// @ts-check
import { execSync } from 'node:child_process'

const OWNER = 'cedarjs'
const REPO = 'cedar'
const WORKFLOW_FILE = 'ci.yml'
const DEFAULT_BRANCH = 'next'
const COUNT = 20

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
  } catch (error) {
    console.error('❌ Error: Could not find GitHub token.')
    console.error(
      'Please set GH_TOKEN environment variable or login with `gh auth login`.',
    )
    process.exit(1)
  }
}

async function fetchWorkflowRuns(
  token,
  branch = DEFAULT_BRANCH,
  count = COUNT,
) {
  // changed status=completed to status=success
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?status=success&branch=${branch}&per_page=${count}`

  console.log(
    `Fetching last ${count} successful runs for workflow '${WORKFLOW_FILE}' on branch '${branch}'...`,
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

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000)
  const seconds = ((ms % 60000) / 1000).toFixed(0)
  return `${minutes}m ${seconds}s`
}

async function main() {
  const token = getGhToken()
  // Allow passing branch as first argument, count as second
  const branch = process.argv[2] || DEFAULT_BRANCH
  const count = parseInt(process.argv[3] || String(COUNT), 10)

  try {
    const runs = await fetchWorkflowRuns(token, branch, count)

    if (!runs || runs.length === 0) {
      console.log('No successful runs found.')
      return
    }

    console.log(`\nFound ${runs.length} runs. calculating statistics...\n`)

    let totalDurationMs = 0
    const stats = runs.map((run) => {
      // run_started_at is more accurate for actual execution time than created_at
      const start = new Date(run.run_started_at || run.created_at).getTime()
      const end = new Date(run.updated_at).getTime()
      const durationMs = end - start
      totalDurationMs += durationMs

      return {
        id: run.id,
        date: new Date(run.created_at).toLocaleDateString(),
        durationMs,
        durationStr: formatDuration(durationMs),
        conclusion: run.conclusion,
        html_url: run.html_url,
      }
    })

    // Print Table
    console.log(
      `| ${'Date'.padEnd(12)} | ${'Duration'.padEnd(10)} | ${'Status'.padEnd(10)} | ${'ID'.padEnd(12)} |`,
    )
    console.log(
      `|${'-'.repeat(14)}|${'-'.repeat(12)}|${'-'.repeat(12)}|${'-'.repeat(14)}|`,
    )

    stats.forEach((run) => {
      console.log(
        `| ${run.date.padEnd(12)} | ${run.durationStr.padEnd(10)} | ${run.conclusion.padEnd(10)} | ${String(run.id).padEnd(12)} |`,
      )
    })

    const averageDurationMs = totalDurationMs / runs.length

    console.log(`\n📊 Average Duration: ${formatDuration(averageDurationMs)}`)
    console.log(`(Based on last ${runs.length} successful runs on '${branch}')`)
  } catch (error) {
    console.error('Error:', error.message)
  }
}

main()
