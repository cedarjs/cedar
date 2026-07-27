// @ts-check

/**
 * Shared helpers for the require-milestone (check, read-only) and
 * assign-milestone (auto-assign, needs write) actions.
 */

import fs from 'node:fs'

/**
 * @typedef {Object} MilestoneEnv
 * @property {string} GITHUB_EVENT_PATH - Path to the event webhook payload
 *   file on the runner. Set by the GitHub Actions runner.
 * @property {string} GITHUB_TOKEN - GitHub token for API requests.
 * @property {string} GITHUB_REPOSITORY - The owner and repository name.
 */

/**
 * @typedef {Object} PullRequestDetails
 * @property {string} title - The title of the pull request.
 * @property {number} number - The pull request number.
 * @property {{ title: string }|null} milestone - The milestone associated
 *   with the pull request.
 */

/**
 * Reads the environment variables the milestone actions need.
 * @see https://docs.github.com/en/actions/learn-github-actions/variables#default-environment-variables
 * @returns {MilestoneEnv}
 */
export function getMilestoneEnv() {
  return {
    GITHUB_EVENT_PATH: process.env.GITHUB_EVENT_PATH || '',
    GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY || '',
  }
}

/**
 * Determines the appropriate milestone based on conventional commit format
 * @param {string} title - The PR title
 * @returns {string|null} - The milestone name or null if no match
 */
export function getMilestoneFromConventionalCommit(title) {
  // Breaking changes (indicated by !)
  if (/^(feat|fix|docs|chore)(\([^)]+\))!:/.test(title)) {
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
 * Reads the PR number from the event webhook payload.
 * @param {MilestoneEnv} env
 * @returns {number}
 */
export function getPullRequestNumberFromEvent(env) {
  const event = fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf-8')

  /** @type {{ pull_request: { number: number } }} */
  const { pull_request: pullRequest } = JSON.parse(event)

  return pullRequest.number
}

/**
 * Fetches the current PR state from the API to get the latest title and
 * milestone. Reading the PR details from the event payload will give stale
 * data if for example the PR title has been updated. The event payload
 * contains data from when the workflow was originally triggered.
 * @param {MilestoneEnv} env
 * @param {number} prNumber
 * @returns {Promise<PullRequestDetails|null>} - Null if the fetch failed.
 */
export async function fetchPullRequestDetails(env, prNumber) {
  const [owner, repo] = env.GITHUB_REPOSITORY.split('/')

  const prResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
    },
  )

  if (!prResponse.ok) {
    console.error(
      `Failed to fetch PR details: ${prResponse.status} ${prResponse.statusText}`,
    )
    return null
  }

  return prResponse.json()
}

/**
 * Fetches the repository's open milestones.
 * @param {MilestoneEnv} env
 * @returns {Promise<Array<{ title: string, number: number }>|null>} - Null if
 *   the fetch failed.
 */
export async function fetchOpenMilestones(env) {
  const [owner, repo] = env.GITHUB_REPOSITORY.split('/')

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
    return null
  }

  return milestonesResponse.json()
}
