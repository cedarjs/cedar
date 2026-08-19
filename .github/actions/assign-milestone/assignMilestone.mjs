// @ts-check

/**
 * Automatically assigns a milestone to a PR based on its conventional-commit
 * title. This needs a write-capable GITHUB_TOKEN, which is why it's separate
 * from the read-only require-milestone check action - see the comments in
 * .github/workflows/assign-milestone.yml for the full reasoning.
 */

import {
  fetchOpenMilestones,
  fetchPullRequestDetails,
  getMilestoneEnv,
  getMilestoneFromConventionalCommit,
  getPullRequestNumberFromEvent,
} from '../milestoneLib.mjs'

/**
 * Sets the milestone on a pull request using the GitHub API
 * @param {ReturnType<typeof getMilestoneEnv>} env
 * @param {number} prNumber - The pull request number
 * @param {string} milestoneName - The name of the milestone to set
 * @returns {Promise<boolean>} - True if the milestone was set successfully, false otherwise
 */
async function setMilestone(env, prNumber, milestoneName) {
  const [owner, repo] = env.GITHUB_REPOSITORY.split('/')

  // First, get the list of milestones to find the milestone number
  const milestones = await fetchOpenMilestones(env)

  if (!milestones) {
    return false
  }

  const milestone = milestones.find((m) => m.title === milestoneName)

  if (!milestone) {
    console.error(`Milestone "${milestoneName}" not found in repository`)
    return false
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
    return false
  }

  console.log(
    `Successfully set milestone "${milestoneName}" on PR #${prNumber}`,
  )
  return true
}

async function main() {
  const env = getMilestoneEnv()

  if (!env.GITHUB_TOKEN) {
    console.error('GITHUB_TOKEN is not set. Cannot fetch PR details.')
    process.exitCode = 1
    return
  }

  const prNumber = getPullRequestNumberFromEvent(env)
  const pullRequest = await fetchPullRequestDetails(env, prNumber)

  if (!pullRequest) {
    process.exitCode = 1
    return
  }

  const { title, milestone } = pullRequest

  // If milestone already exists, there's nothing to assign
  if (milestone) {
    console.log(`PR already has milestone: ${milestone.title}`)
    return
  }

  const suggestedMilestone = getMilestoneFromConventionalCommit(title)

  if (!suggestedMilestone) {
    // Not an error for this workflow - the "🚩 Require milestone" required
    // check is responsible for flagging PRs without a milestone
    console.log(
      `PR title "${title}" doesn't match conventional commit format and no ` +
        'milestone is set. Nothing to assign.',
    )
    return
  }

  console.log(
    `PR title "${title}" matches conventional commit format. ` +
      `Automatically setting milestone to "${suggestedMilestone}"...`,
  )

  const milestoneSet = await setMilestone(env, prNumber, suggestedMilestone)

  if (!milestoneSet) {
    process.exitCode = 1
  }
}

main()
