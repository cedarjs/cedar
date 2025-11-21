// @ts-check

/**
 * @typedef {Object} ProcessEnv
 * @property {string} GITHUB_EVENT_PATH - `GITHUB_EVENT_PATH` is set in the
 *   GitHub Actions runner.
 *   It's the path to the file on the runner that contains the full event
 *   webhook payload.
 *   @see https://docs.github.com/en/actions/learn-github-actions/variables#default-environment-variables.
 * @property {string} GITHUB_TOKEN - GitHub token for API requests.
 * @property {string} GITHUB_REPOSITORY - The owner and repository name.
 */

/**
 * @typedef {Object} PullRequest
 * @property {string} title - The title of the pull request.
 * @property {number} number - The pull request number.
 * @property {{ login: string }} user - The user who created the pull request.
 * @property {Object|null} milestone - The milestone associated with the pull request.
 */

/**
 * @typedef {Object} GitHubEvent
 * @property {PullRequest} pull_request - The pull request object from the
 *   GitHub event payload.
 * @property {{ login: string }} sender - The user who triggered the event.
 */

/** @type {ProcessEnv} */
const env = {
  GITHUB_EVENT_PATH: process.env.GITHUB_EVENT_PATH || '',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY || '',
}

import fs from 'node:fs'

/**
 * Determines the appropriate milestone based on conventional commit format
 * @param {string} title - The PR title
 * @returns {string|null} - The milestone name or null if no match
 */
function getMilestoneFromConventionalCommit(title) {
  // Breaking changes (indicated by !)
  if (/^(feat|fix|docs|chore)!(\([^)]+\))?:/.test(title)) {
    return 'next-release-major'
  }

  // Feature (goes in next minor release)
  if (/^feat\([^)]+\):/.test(title)) {
    return 'next-release'
  }

  // Fix (goes in next patch release)
  if (/^(fix|docs)\([^)]+\):/.test(title)) {
    return 'next-release-patch'
  }

  // Chore (framework-side maintenance)
  if (/^chore\([^)]+\):/.test(title)) {
    return 'chore'
  }

  return null
}

/**
 * Sets the milestone on a pull request using the GitHub API
 * @param {number} prNumber - The pull request number
 * @param {string} milestoneName - The name of the milestone to set
 * @returns {Promise<void>}
 */
async function setMilestone(prNumber, milestoneName) {
  if (!env.GITHUB_TOKEN) {
    console.error(
      'GITHUB_TOKEN is not set. Cannot automatically set milestone.',
    )
    return
  }

  const [owner, repo] = env.GITHUB_REPOSITORY.split('/')

  // First, get the list of milestones to find the milestone number
  const milestonesResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/milestones?state=open&per_page=100`,
    {
      headers: {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
    },
  )

  if (!milestonesResponse.ok) {
    console.error(
      `Failed to fetch milestones: ${milestonesResponse.status} ${milestonesResponse.statusText}`,
    )
    return
  }

  const milestones = await milestonesResponse.json()
  const milestone = milestones.find((m) => m.title === milestoneName)

  if (!milestone) {
    console.error(`Milestone "${milestoneName}" not found in repository`)
    return
  }

  // Set the milestone on the PR
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        milestone: milestone.number,
      }),
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error(
      `Failed to set milestone: ${response.status} ${response.statusText}\n${errorText}`,
    )
    return
  }

  console.log(
    `Successfully set milestone "${milestoneName}" on PR #${prNumber}`,
  )
}

async function main() {
  const event = fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf-8')

  /** @type {GitHubEvent} */
  const {
    pull_request: { title, number, milestone },
  } = JSON.parse(event)

  // If milestone already exists, we're good
  if (milestone) {
    console.log(`PR already has milestone: ${milestone.title}`)
    return
  }

  // Check if the PR title uses conventional commit format
  const suggestedMilestone = getMilestoneFromConventionalCommit(title)

  if (suggestedMilestone) {
    console.log(
      `PR title "${title}" matches conventional commit format. ` +
        `Automatically setting milestone to "${suggestedMilestone}"...`,
    )

    await setMilestone(number, suggestedMilestone)

    return
  }

  // No milestone and no conventional commit format - show error
  process.exitCode = 1

  console.error(
    [
      "A pull request must have a milestone that indicates where it's supposed to be released:",
      '',
      "- next-release       -- the PR should be released in the next minor (it's a feature)",
      "- next-release-patch -- the PR should be released in the next patch (it's a bug fix or project-side chore)",
      "- next-release-major -- the PR should be released in the next major (it's breaking or builds off a breaking PR)",
      "- chore              -- the PR is a framework-side chore (changes CI, tasks, etc.) and it isn't released, per se",
      '',
      'Alternatively, you can update the PR title to use conventional commit format:',
      '- feat(scope): for new features → automatically sets "next-release"',
      '- fix(scope): for bug fixes → automatically sets "next-release-patch"',
      '- docs(scope): for documentation changes → automatically sets "next-release-patch"',
      '- chore(scope): for maintenance tasks → automatically sets "chore"',
      '- feat!(scope): or fix!(scope): for breaking changes → automatically sets "next-release-major"',
      '',
      'Where "scope" should describe the area of the codebase being changed.',
      '',
      `(If you're still not sure, go with "next-release".)`,
    ].join('\n'),
  )
}

main()
