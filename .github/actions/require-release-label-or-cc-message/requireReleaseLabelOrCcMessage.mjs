// @ts-check

/**
 * @typedef {Object} ProcessEnv
 * @property {string} GITHUB_EVENT_PATH - `GITHUB_EVENT_PATH` is set in the
 *   GitHub Actions runner.
 *   It's the path to the file on the runner that contains the full event
 *   webhook payload.
 *   @see https://docs.github.com/en/actions/learn-github-actions/variables#default-environment-variables.
 */

/**
 * @typedef {Object} PullRequest
 * @property {string} title - The title of the pull request.
 * @property {Array<{ name: string }>} labels - The labels associated with the
 *   pull request.
 */

/**
 * @typedef {Object} GitHubEvent
 * @property {PullRequest} pull_request - The pull request object from the
 *   GitHub event payload.
 */

/** @type {ProcessEnv} */
const env = {
  GITHUB_EVENT_PATH: process.env.GITHUB_EVENT_PATH || '',
}

import fs from 'node:fs'

function main() {
  const event = fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf-8')

  /** @type {GitHubEvent} */
  const {
    pull_request: { title, labels },
  } = JSON.parse(event)

  // Check if the PR title starts with conventional commit prefixes that should skip label requirement
  const conventionalCommitPrefixes = [
    /^chore\([^)]+\):/,
    /^feat\([^)]+\):/,
    /^fix\([^)]+\):/,
    /^docs\([^)]+\):/,
  ]

  const shouldSkipLabelRequirement = conventionalCommitPrefixes.some((prefix) =>
    prefix.test(title),
  )

  if (shouldSkipLabelRequirement) {
    console.log(
      `PR title "${title}" starts with conventional commit prefix. Skipping release label requirement.`,
    )
    return
  }

  // Define required release labels
  const requiredLabels = [
    'release:docs',
    'release:chore',
    'release:experimental-breaking',
    'release:fix',
    'release:feature',
    'release:breaking',
    'release:dependency',
  ]

  // Check if PR has exactly one of the required release labels
  const presentReleaseLabels = labels
    .map((label) => label.name)
    .filter((labelName) => requiredLabels.includes(labelName))

  if (presentReleaseLabels.length === 1) {
    console.log(`PR has required release label: ${presentReleaseLabels[0]}`)
    return
  }

  // If we get here, the PR doesn't have the right number of release labels
  process.exitCode = 1

  if (presentReleaseLabels.length === 0) {
    console.error(
      [
        `PR title "${title}" does not start with a conventional commit ` +
          'prefix, so it requires exactly one release label.',
        '',
        'Please add exactly one of the following labels:',
        ...requiredLabels.map((label) => `- ${label}`),
        '',
        'Alternatively, you can update the PR title to start with one of ' +
          'these conventional commit prefixes:',
        '- chore(scope): for maintenance tasks',
        '- feat(scope): for new features',
        '- fix(scope): for bug fixes',
        '- docs(scope): for documentation changes',
        '',
        'Where "scope" should describe the area of the codebase being changed.',
      ].join('\n'),
    )
  } else {
    console.error(
      [
        `PR has ${presentReleaseLabels.length} release labels but exactly 1 ` +
          'is required.',
        '',
        `Present labels: ${presentReleaseLabels.join(', ')}`,
        '',
        'Please ensure the PR has exactly one of the following labels:',
        ...requiredLabels.map((label) => `- ${label}`),
      ].join('\n'),
    )
  }
}

main()
