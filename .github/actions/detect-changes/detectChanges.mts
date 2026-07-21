import fs from 'node:fs'

import core from '@actions/core'

import { cliChanged } from './cases/cli.mts'
import { codeChanges } from './cases/code_changes.mts'
import { rscChanged } from './cases/rsc.mts'
import { ssrChanged } from './cases/ssr.mts'
import type { PrFile } from './cases/windows.mts'
import { windowsChanged } from './cases/windows.mts'

const BASE_URL = 'https://api.github.com/repos/cedarjs/cedar'

interface GhEventPayload {
  pull_request?: {
    number: number
  }
}

const getPrNumber = (): number | string => {
  // Example GITHUB_REF refs/pull/9544/merge
  const result = /refs\/pull\/(\d+)\/merge/g.exec(process.env.GITHUB_REF ?? '')

  let prNumber: number | string | undefined = result?.[1]

  if (!prNumber) {
    try {
      // Example GITHUB_EVENT_PATH
      // /home/runner/work/_temp/_github_workflow/event.json
      const ev: GhEventPayload = JSON.parse(
        fs.readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'),
      )
      prNumber = ev.pull_request?.number
    } catch {
      // fall through
    }
  }

  if (!prNumber) {
    throw new Error('Could not find the PR number')
  }

  return prNumber
}

interface GhPullResponse {
  head?: {
    ref?: string
    sha?: string
  }
  labels?: { name: string }[]
}

interface PrInfo {
  branchName: string | undefined
  headSha: string | undefined
  /**
   * Whether the PR has the `windows` label (which forces the Windows CI legs
   * to run). The label is read from the API rather than the event payload so
   * that re-running CI after adding the label picks it up.
   */
  hasWindowsLabel: boolean
}

async function getPrInfo(): Promise<PrInfo> {
  const prNumber = getPrNumber()

  const { json } = await fetchJson<GhPullResponse>(
    `${BASE_URL}/pulls/${prNumber}`,
  )

  return {
    branchName: json?.head?.ref,
    headSha: json?.head?.sha,
    hasWindowsLabel: (json?.labels || []).some(
      (label) => label.name === 'windows',
    ),
  }
}

interface Workflow {
  updated_at: string
  id: number
  status: string
  conclusion: string
  head_sha: string
}

interface GhWorkflowRunsResponse {
  workflow_runs?: Workflow[]
}

/**
 * Conclusions that represent an actual CI verdict for the branch. Cancelled,
 * skipped, stale etc runs prove nothing about the state of the code (they're
 * usually the result of a force-push or a newer push aborting an in-flight
 * run), so they can't serve as a baseline for "what has CI already checked?"
 */
const VERDICT_CONCLUSIONS = ['success', 'failure', 'timed_out']

/**
 * The newest completed workflow run for the branch that produced an actual
 * verdict (see VERDICT_CONCLUSIONS)
 */
async function getBaselineWorkflowRun(
  branchName: string | undefined,
): Promise<Workflow | undefined> {
  if (!branchName) {
    return
  }

  // 154971623 is the ID of the CI workflow (ci.yml). If it changes, or you want
  // to use a different workflow, go to
  // https://api.github.com/repos/cedarjs/cedar/actions/workflows to get a
  // list of all workflows and their IDs
  const workflowId = '154971623'
  const url = `${BASE_URL}/actions/workflows/${workflowId}/runs?branch=${branchName}`
  const { json } = await fetchJson<GhWorkflowRunsResponse>(url)

  return json?.workflow_runs?.find(
    (run) =>
      run.status === 'completed' &&
      VERDICT_CONCLUSIONS.includes(run.conclusion),
  )
}

interface WorkflowJob {
  name: string
  conclusion: string
}

interface GhWorkflowJobsResponse {
  jobs?: WorkflowJob[]
}

async function getWorkflowJobs(
  runId: number,
  page = 1,
): Promise<WorkflowJob[]> {
  const url = `${BASE_URL}/actions/runs/${runId}/jobs?per_page=100&page=${page}`
  const { json, res } = await fetchJson<GhWorkflowJobsResponse>(url)
  let jobs = json?.jobs || []

  const linkHeader = res?.headers?.get('link')
  if (linkHeader?.includes('rel="next"')) {
    const nextJobs = await getWorkflowJobs(runId, page + 1)
    jobs = jobs.concat(nextJobs)
  }

  return jobs
}

function summarizeJobResults(
  jobs: WorkflowJob[],
  prefix: string,
): { hadJobs: boolean; succeeded: boolean } {
  const matchingJobs = jobs.filter((job) => job.name.startsWith(prefix))
  const hadJobs = matchingJobs.length > 0
  const succeeded = hadJobs
    ? matchingJobs.every((job) => job.conclusion === 'success')
    : false

  return { hadJobs, succeeded }
}

interface GhCompareResponse {
  files?: { filename: string }[]
}

/**
 * The files that changed between the baseline run's head commit and the
 * current PR head, using GitHub's compare API (three-dot semantics: the diff
 * between the merge-base of the two commits and `headSha`)
 *
 * This works across force-pushes and amended commits: as long as GitHub still
 * knows about the baseline commit object it doesn't have to be reachable from
 * the branch anymore, and because the diff is taken from the merge-base, an
 * amended commit compares against its parent rather than producing a bogus
 * empty (or full-history) diff
 *
 * @returns `undefined` when the comparison can't be trusted (API error or
 *   truncated file list) and the caller should fall back to the full PR file
 *   list
 */
async function getChangedFilesSince(
  baseSha: string,
  headSha: string,
): Promise<string[] | undefined> {
  const { json } = await fetchJson<GhCompareResponse>(
    `${BASE_URL}/compare/${baseSha}...${headSha}`,
  )

  if (!json?.files) {
    return undefined
  }

  // The compare API caps the file list at 300 entries. If we hit the cap the
  // list might be incomplete, so we can't trust it
  if (json.files.length >= 300) {
    console.log('Compare API returned 300+ files. Treating as incomplete.')
    return undefined
  }

  const changedFiles = json.files.map((file) => file.filename)

  console.log(
    `Files changed since last CI verdict (${baseSha.slice(0, 10)}):`,
    changedFiles,
  )

  return changedFiles
}

interface GhPrFilesResponseEntry {
  filename: string
  patch?: string
}

/**
 * @returns all files changed in the PR, with their unified diffs (absent for
 *   binary files and very large diffs)
 */
async function getChangedFilesInPr(page = 1): Promise<PrFile[]> {
  const prNumber = getPrNumber()

  console.log(`Getting changed files for PR ${prNumber} (page ${page})`)

  // Query the GitHub API to get the changed files in the PR
  const url = `${BASE_URL}/pulls/${prNumber}/files?per_page=100&page=${page}`
  const { json, res } = await fetchJson<GhPrFilesResponseEntry[]>(url)
  let changedFiles: PrFile[] =
    json?.map((file) => ({ filename: file.filename, patch: file.patch })) || []

  // Look at the headers to see if the result is paginated
  const linkHeader = res?.headers?.get('link')
  if (linkHeader?.includes('rel="next"')) {
    const files = await getChangedFilesInPr(page + 1)
    changedFiles = changedFiles.concat(files)
  }

  return changedFiles
}

/** Fetch JSON data from a URL with retries. */
async function fetchJson<T>(
  url: string,
  retries = 0,
): Promise<{ json?: T; res?: Response }> {
  if (retries) {
    console.log(`Retry ${retries}: ${url}`)
  } else {
    console.log('Fetching', url)
  }

  const githubToken =
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.REDWOOD_GITHUB_TOKEN

  try {
    const res = await fetch(url, {
      headers: {
        ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
        ['X-GitHub-Api-Version']: '2022-11-28',
        Accept: 'application/vnd.github+json',
      },
    })

    if (!res.ok) {
      console.log()
      console.error('Response not ok')
      console.log('res', res)

      throw new Error('status: ' + res.status)
    }

    const json: T = await res.json()

    return { json, res }
  } catch (e) {
    if (retries >= 3) {
      console.error(e)

      console.log()
      console.log('Too many retries, giving up.')

      return {}
    } else {
      await new Promise((resolve) => setTimeout(resolve, 3000 * retries))

      const fetchJsonRes = await fetchJson<T>(url, ++retries)
      return fetchJsonRes
    }
  }
}

// We want to get the list of files changed since the last CI verdict for
// this PR, so that a push that only touches docs/changesets can skip the
// heavy test jobs.
//
// 1. Get the PR branch name and head sha
//    https://api.github.com/repos/cedarjs/redmx/pulls/10374  .head.ref, .head.sha
// 2. Get CI workflow runs for that branch
//    https://api.github.com/repos/cedarjs/redmx/actions/workflows/24294187/runs?branch=tobbe-redirect-docs
// 3. Pick the newest completed run with an actual verdict (success/failure) —
//    the "baseline run". Cancelled runs (e.g. aborted by a force-push) are
//    skipped: they prove nothing about the code
// 4. Compare the baseline run's `head_sha` to the current PR head to get the
//    files changed since CI last gave a verdict
//      https://api.github.com/repos/cedarjs/redmx/compare/{base}...{head}
// 5. Use those files in the checks we do in this action

async function main() {
  const branch = process.env.GITHUB_BASE_REF

  // If there's no branch, we're not in a pull request.
  if (!branch) {
    core.setOutput('code', true)
    core.setOutput('cli', true)
    core.setOutput('rsc', false)
    core.setOutput('ssr', false)
    // Pushes (to `next` and release branches) always run the Windows legs.
    core.setOutput('windows', true)
    return
  }

  const { branchName, headSha, hasWindowsLabel } = await getPrInfo()
  const baselineRun = await getBaselineWorkflowRun(branchName)
  const baselineRunSucceeded = baselineRun?.conclusion === 'success'
  const workflowJobs = baselineRun?.id
    ? await getWorkflowJobs(baselineRun.id)
    : []
  const rscJobs = summarizeJobResults(workflowJobs, '🔄🐘 RSC Smoke tests')
  const ssrJobs = summarizeJobResults(workflowJobs, '🔁 SSR Smoke tests')
  const prFiles = await getChangedFilesInPr()
  const prFileNames = prFiles.map((file) => file.filename)
  let changedFiles =
    baselineRun?.head_sha && headSha
      ? ((await getChangedFilesSince(baselineRun.head_sha, headSha)) ?? [])
      : []

  if (changedFiles.length === 0) {
    // Probably the first push to this PR, or the comparison couldn't be
    // trusted - get all files
    changedFiles = prFileNames
  } else {
    // `changedFiles` includes any files changed by merge commits. But if those
    // files are not part of the files this PR changes as a whole we can ignore
    // them. (This isn't 100% safe, but it's the same as we do when we allow
    // merging PRs even if main has updated as long as there are no merge
    // conflicts)
    changedFiles = changedFiles.filter((file) => prFileNames.includes(file))

    if (changedFiles.length === 0) {
      // If all changed files were filtered out above this was most likely
      // just a merge commit (like if someone pressed the "Update branch"
      // button on GitHub). We could just skip running CI (see comment above
      // about not being 100% safe), but let's instead consider all files
      // changed by this PR when deciding what tests to run.
      changedFiles = prFileNames
    }
  }

  console.log(`${changedFiles.length} changed files`)

  if (changedFiles.length === 0) {
    console.log(
      'No changed files found. Something must have gone wrong. Falling back ' +
        'to running all tests.',
    )
    core.setOutput('code', true)
    core.setOutput('cli', true)
    core.setOutput('rsc', true)
    core.setOutput('ssr', true)
    core.setOutput('windows', true)
    return
  }

  if (!codeChanges(changedFiles)) {
    console.log('Only docs and/or changesets changes detected')

    // We need to guard against first having a code change that fails in CI,
    // and then pushing just a docs/changesets change – detecting the docs-only
    // change and then skipping CI. If the baseline verdict is a failure, we
    // need to run all tests again, even if the latest commit is only touching
    // docs. (Cancelled runs never become the baseline, so a run aborted by a
    // force-push doesn't count as a failure here)
    if (baselineRun && !baselineRunSucceeded) {
      console.log(
        `Baseline run concluded '${baselineRun.conclusion}'. Falling back ` +
          'to running all tests.',
      )
      core.setOutput('code', true)
      core.setOutput('cli', true)
      core.setOutput('rsc', true)
      core.setOutput('ssr', true)
      core.setOutput('windows', true)
    } else {
      core.setOutput('code', false)
      core.setOutput('cli', false)
      core.setOutput('rsc', false)
      core.setOutput('ssr', false)
      core.setOutput('windows', false)
    }

    return
  }

  const rscChangesDetected = rscChanged(changedFiles)
  const ssrChangesDetected = ssrChanged(changedFiles)
  const cliChangesDetected = cliChanged(changedFiles)
  // Evaluates the full PR diff (not just `changedFiles`) so a Windows-
  // sensitive change in an early commit keeps the Windows legs running on
  // later pushes too. The `windows` label forces the Windows legs to run
  // (rerun-ci-on-windows-label.yml re-runs CI when the label is added).
  const windowsChangesDetected = hasWindowsLabel || windowsChanged(prFiles)

  core.setOutput('code', true)
  core.setOutput('cli', cliChangesDetected)
  core.setOutput('windows', windowsChangesDetected)
  core.setOutput(
    'rsc',
    rscChangesDetected || (rscJobs.hadJobs && !rscJobs.succeeded),
  )
  core.setOutput(
    'ssr',
    ssrChangesDetected || (ssrJobs.hadJobs && !ssrJobs.succeeded),
  )
}

main()
