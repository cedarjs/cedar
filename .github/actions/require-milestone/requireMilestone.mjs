// @ts-check

/**
 * Required check: verifies that a PR either has a milestone, or has a
 * conventional-commit title that maps to an existing open milestone (which
 * the "🎯 Assign milestone" workflow will then set automatically).
 *
 * This script only READS PR metadata, so it works with the read-only
 * GITHUB_TOKEN that fork PRs get. The actual milestone assignment, which
 * needs a write-capable token, lives in the assign-milestone action.
 *
 * Note that the check must pass on a mapping conventional-commit title alone
 * (rather than waiting for the milestone to actually be set): the assign
 * workflow sets the milestone using GITHUB_TOKEN, and events caused by
 * GITHUB_TOKEN don't trigger new workflow runs, so that assignment will NOT
 * re-run this check. A maintainer manually (de)assigning a milestone does
 * re-run it.
 *
 * This does mean the check can be green while the assignment hasn't happened
 * (yet). That gap is deliberately small and visible: the most likely
 * assignment failure - the mapped milestone not existing - fails THIS check
 * too (see below), a transient API failure shows up as a red (non-required)
 * "🎯 Assign milestone" check and is retried on the next push or edit, and a
 * concurrency cancellation only happens when a newer run supersedes it and
 * assigns instead. Same accepted pattern as the require-release-label check,
 * which passes on a conventional-commit title without any label being set.
 */

import {
  fetchOpenMilestones,
  fetchPullRequestDetails,
  getMilestoneEnv,
  getMilestoneFromConventionalCommit,
  getPullRequestNumberFromEvent,
} from '../milestoneLib.mjs'

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

  // If milestone already exists, we're good
  if (milestone) {
    console.log(`PR already has milestone: ${milestone.title}`)
    return
  }

  // Check if the PR title uses conventional commit format
  const suggestedMilestone = getMilestoneFromConventionalCommit(title)

  if (suggestedMilestone) {
    const milestones = await fetchOpenMilestones(env)

    if (!milestones) {
      process.exitCode = 1
      return
    }

    if (milestones.some((m) => m.title === suggestedMilestone)) {
      console.log(
        `PR title "${title}" matches conventional commit format. ` +
          `The "🎯 Assign milestone" workflow will set the milestone to ` +
          `"${suggestedMilestone}".`,
      )
      return
    }

    console.error(
      `Milestone "${suggestedMilestone}" (derived from the PR title ` +
        `"${title}") does not exist as an open milestone in this repository, ` +
        'so it cannot be auto-assigned. Please set a milestone manually, or ' +
        'create the milestone.',
    )
    process.exitCode = 1
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
      '- feat(scope)!: or fix(scope)!: for breaking changes → automatically sets "next-release-major"',
      '',
      'Where "scope" should describe the area of the codebase being changed.',
      '',
      `(If you're still not sure, go with "next-release".)`,
    ].join('\n'),
  )
}

main()
