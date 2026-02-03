import { execSync } from 'node:child_process'

const OWNER = 'cedarjs'
const REPO = 'cedar'
const WORKFLOW_FILE = 'ci.yml'
const DEFAULT_COUNT = 20
const ONE_DAY_MS = 24 * 60 * 60 * 1000

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
  startDateStr: string | null = null,
  endDateStr: string | null = null,
  limit: number | null = null,
  verbose = false,
): Promise<Record<string, any>[]> {
  let branchMsg = 'all branches'

  if (branch) {
    branchMsg = `branch '${branch}'`
  }

  let dateMsg = ''
  if (startDateStr && endDateStr) {
    dateMsg = ` between ${startDateStr} and ${endDateStr}`
  } else if (startDateStr) {
    dateMsg = ` since ${startDateStr}`
  } else if (endDateStr) {
    dateMsg = ` until ${endDateStr}`
  }

  console.log(
    `Fetching successful runs for workflow '${WORKFLOW_FILE}' on ${branchMsg}${dateMsg}...`,
  )

  // If no date filtering requested, fall back to a single request (previous behavior)
  if (!startDateStr && !endDateStr) {
    const url =
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?status=success&per_page=${count}` +
      (branch ? `&branch=${branch}` : '')

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

  // Date range provided -> paginate pages (runs are returned newest-first)
  const perPage = 100
  let page = 1
  const collected: Record<string, any>[] = []

  let startMs: number | null = null
  let endMs: number | null = null

  if (startDateStr) {
    const parsed = new Date(startDateStr)
    if (isNaN(parsed.getTime())) {
      throw new Error(`Invalid start date: ${startDateStr}`)
    }
    startMs = parsed.getTime()
  }

  if (endDateStr) {
    const parsed = new Date(endDateStr)
    if (isNaN(parsed.getTime())) {
      throw new Error(`Invalid end date: ${endDateStr}`)
    }
    // Parse the raw end date (midnight at the start of that day). We'll convert
    // it to the exclusive boundary (start of the following day) after any
    // necessary start/end swapping so we don't change the ordering unintentionally.
    endMs = parsed.getTime()
  }

  // Ensure startMs <= endMs if both provided
  if (startMs !== null && endMs !== null && startMs > endMs) {
    const tmp = startMs
    startMs = endMs
    endMs = tmp
  }

  // If an end date was provided, make it an exclusive boundary by moving it
  // to the start of the next day. This ensures the user-provided end date is
  // treated as inclusive (i.e., all runs on the end date are considered).
  if (endMs !== null) {
    endMs += ONE_DAY_MS
  }

  let keepGoing = true
  // When verbose diagnostics are on we restrict per-run logging to a small
  // window around the requested date boundaries so the output is concise.
  // These defaults will be updated per page when verbose is enabled.
  let windowStart = Number.MIN_SAFE_INTEGER
  let windowEnd = Number.MAX_SAFE_INTEGER

  while (keepGoing) {
    const url =
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?status=success&per_page=${perPage}&page=${page}` +
      (branch ? `&branch=${branch}` : '')

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
    const runs = data.workflow_runs || []

    if (verbose) {
      // Update the compact debug window (1 day each side of the inclusive day range)
      windowStart =
        startMs !== null ? startMs - ONE_DAY_MS : Number.MIN_SAFE_INTEGER
      // endMs is the exclusive boundary (start of the next day), so it already
      // represents end date + 1 day and can be used as-is for the debug window.
      windowEnd = endMs !== null ? endMs : Number.MAX_SAFE_INTEGER

      const first = runs[0]
      const last = runs[runs.length - 1]
      console.log(
        `[verbose] page ${page}: fetched ${runs.length} runs${
          first && last
            ? ` (first: ${first.created_at}, last: ${last.created_at})`
            : ''
        }`,
      )
      console.log(
        `[verbose] computed start boundary (inclusive): ${startMs !== null ? new Date(startMs).toISOString() : '(none)'}`,
      )
      console.log(
        `[verbose] computed end boundary (exclusive): ${endMs !== null ? new Date(endMs).toISOString() : '(none)'}`,
      )
      console.log(
        `[verbose] debug window: ${new Date(windowStart).toISOString()} -> ${new Date(windowEnd).toISOString()}`,
      )
    }

    if (!runs || runs.length === 0) {
      break
    }

    for (const run of runs) {
      const runStart = new Date(run.run_started_at || run.created_at).getTime()
      const runEnd = new Date(
        run.updated_at || run.run_started_at || run.created_at,
      ).getTime()

      // If an end date was provided, skip runs that start or finish on or after
      // the exclusive boundary (start of the next day). This guarantees the
      // entire run falls within the requested inclusive date range.
      if (endMs !== null && (runStart >= endMs || runEnd >= endMs)) {
        continue
      }

      // If this run started before the start date, we can stop paginating (results are newest-first)
      if (startMs !== null && runStart < startMs) {
        keepGoing = false
        break
      }

      // Otherwise, this run is within the requested window
      collected.push(run)

      if (limit !== null && collected.length >= limit) {
        keepGoing = false
        break
      }
    }

    if (keepGoing) {
      page += 1
    }
  }

  return collected
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
  // node script.mjs [count] [branch] [startDate] [endDate]
  let count = DEFAULT_COUNT
  let branch: string | null = null
  let startDateStr: string | null = null
  let endDateStr: string | null = null
  let countWasProvided = false

  const rawArgs = process.argv.slice(2)
  const verbose = rawArgs.includes('--verbose') || rawArgs.includes('-v')

  // Support inspecting a single run for debugging:
  // - `--inspect-run=12345` or `--inspect-run 12345`
  let inspectRunId: string | null = null
  for (let i = 0; i < rawArgs.length; i += 1) {
    const a = rawArgs[i]
    if (a.startsWith('--inspect-run')) {
      if (a.includes('=')) {
        inspectRunId = a.split('=')[1]
      } else {
        inspectRunId = rawArgs[i + 1] ?? null
      }
      break
    }
  }

  const args = rawArgs.filter(
    (a) =>
      a !== '--verbose' &&
      a !== '-v' &&
      !a.startsWith('--inspect-run') &&
      a !== inspectRunId,
  )

  const arg1 = args[0]
  const arg2 = args[1]
  const arg3 = args[2]
  const arg4 = args[3]

  if (verbose) {
    console.log('🔍 Verbose mode enabled')
  }

  // If the user asked to inspect a run, fetch that single run and print its timestamps
  // then exit (useful for quickly checking created_at / run_started_at boundaries).
  if (inspectRunId) {
    try {
      console.log(`Inspecting run ${inspectRunId}...`)
      const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${inspectRunId}`
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      })
      if (!response.ok) {
        console.error(
          `Failed to fetch run ${inspectRunId}: ${response.status} ${response.statusText}`,
        )
        process.exit(1)
      }
      const run = await response.json()
      // Pretty-print the timestamps and a few key fields for quick debugging
      console.log(
        JSON.stringify(
          {
            id: run.id,
            head_branch: run.head_branch,
            created_at: run.created_at,
            run_started_at: run.run_started_at,
            updated_at: run.updated_at,
            conclusion: run.conclusion,
          },
          null,
          2,
        ),
      )
      return
    } catch (err) {
      if (err instanceof Error) {
        console.error('Error fetching run:', err.message)
      } else {
        console.error('Unexpected error fetching run:', err)
      }
      process.exit(1)
    }
  }

  function isDateString(s: string | undefined): boolean {
    if (!s) {
      return false
    }
    const d = new Date(s)
    if (isNaN(d.getTime())) {
      return false
    }
    return true
  }

  // Parse positional args and accept multiple layouts:
  // - [count] [branch] [startDate endDate]
  // - [startDate endDate]
  // - [branch startDate endDate]
  // - [count startDate endDate]
  if (arg1) {
    // Treat a count as only a pure integer string (no dashes or other chars).
    // This prevents date-like strings like "2026-01-14" from being parsed as counts.
    if (/^\d+$/.test(arg1)) {
      const parsedCount = parseInt(arg1, 10)
      count = parsedCount
      countWasProvided = true

      // After a numeric count, accept either [count <start> <end>] OR [count <branch> <start> <end>]
      if (arg2 && isDateString(arg2) && arg3 && isDateString(arg3)) {
        startDateStr = arg2
        endDateStr = arg3
      } else {
        // Otherwise, treat arg2 as branch and then possibly dates after
        if (arg2) {
          branch = arg2
        }
        if (arg3 || arg4) {
          if (!arg3 || !arg4) {
            console.error(
              'Both start and end dates must be provided if a date is supplied.',
            )
            process.exit(1)
          }
          if (!isDateString(arg3) || !isDateString(arg4)) {
            console.error(`Invalid date(s): ${arg3} ${arg4}`)
            process.exit(1)
          }
          startDateStr = arg3
          endDateStr = arg4
        }
      }

      if (count > 90) {
        // We'll overfetch by 10 to ensure we have enough runs after filtering.
        // GitHub API has a limit of 100 runs per page, so unless we want to add
        // support for pagination, we'll have to limit the count to 90 (90 + 10 =
        // 100).
        console.error(`Count cannot exceed 90`)
        process.exit(1)
      }
    } else if (arg2 && isDateString(arg1) && isDateString(arg2)) {
      // date-only mode: arg1 = start, arg2 = end
      startDateStr = arg1
      endDateStr = arg2
    } else {
      // treat arg1 as branch
      branch = arg1
      // and check for start/end after the branch
      if (arg2 || arg3) {
        if (!arg2 || !arg3) {
          console.error(
            'Both start and end dates must be provided as positional arguments after the branch.',
          )
          process.exit(1)
        }
        if (!isDateString(arg2) || !isDateString(arg3)) {
          console.error(`Invalid date(s): ${arg2} ${arg3}`)
          process.exit(1)
        }
        startDateStr = arg2
        endDateStr = arg3
      }
    }
  }

  // Validate start/end dates if set; require both or none
  if ((startDateStr && !endDateStr) || (!startDateStr && endDateStr)) {
    console.error(
      'Both start and end dates must be provided (e.g. YYYY-MM-DD YYYY-MM-DD).',
    )
    process.exit(1)
  }

  // If both dates provided and reversed, swap them so start <= end
  if (startDateStr && endDateStr) {
    const startMs = new Date(startDateStr).getTime()
    const endMs = new Date(endDateStr).getTime()
    if (isNaN(startMs) || isNaN(endMs)) {
      console.error('Invalid date provided.')
      process.exit(1)
    }
    if (startMs > endMs) {
      const tmp = startDateStr
      startDateStr = endDateStr
      endDateStr = tmp
    }
  }

  try {
    // Overfetch by 10 to ensure we have enough runs after filtering
    const fetchCount = count + 10
    const runs = await fetchWorkflowRuns(
      token,
      fetchCount,
      branch,
      startDateStr,
      endDateStr,
      countWasProvided ? count : null,
      verbose,
    )

    if (!runs || runs.length === 0) {
      console.log('No successful runs found.')
      return
    }

    console.log('')
    console.log(`Filtering runs (<10m or >40m) and calculating statistics...`)
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
    const maxDurationMs = 40 * 60 * 1000

    let stats = allStats.filter(
      (run) =>
        run.durationMs >= minDurationMs && run.durationMs <= maxDurationMs,
    )
    if (countWasProvided) {
      stats = stats.slice(0, count)
    }

    if (stats.length === 0) {
      console.log(
        `No runs between 10 and 40 minutes found in the last ${runs.length} entries.`,
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
