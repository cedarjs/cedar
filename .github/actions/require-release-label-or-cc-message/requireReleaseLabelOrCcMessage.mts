interface PullRequest {
  /** The title of the pull request */
  title: string
  /** The pull request number */
  number: number
  /** The labels associated with the pull request */
  labels: { name: string }[]
}

interface GitHubEvent {
  /** The pull request object from the GitHub event payload */
  pull_request: PullRequest
}

/** Environment variables needed for the script. */
const env = {
  /**
   * `GITHUB_EVENT_PATH` - This is set by the GitHub Actions runner.
   * It's the path to the file on the runner that contains the full event
   * webhook payload.
   * @see https://docs.github.com/en/actions/learn-github-actions/variables#default-environment-variables.
   */
  GITHUB_EVENT_PATH: process.env.GITHUB_EVENT_PATH || '',
  /**
   * `GITHUB_TOKEN` - GitHub token for API requests
   * From github-token input, which gets prefixed by `INPUT_` and made available
   * as an environment variable.
   * @see https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax#example-specifying-inputs
   */
  GITHUB_TOKEN: process.env['INPUT_GITHUB-TOKEN'] || '',
  /** `GITHUB_REPOSITORY` - The owner and repository name */
  GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY || '',
}

import fs from 'node:fs'

async function main() {
  const event = fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf-8')

  const { pull_request: pullRequest }: GitHubEvent = JSON.parse(event)

  const [owner, repo] = env.GITHUB_REPOSITORY.split('/')

  if (!env.GITHUB_TOKEN) {
    console.error('GITHUB_TOKEN is not set. Cannot fetch PR details.')
    process.exitCode = 1
    return
  }

  // Fetch the current PR state from the API to get the latest title and
  // labels. Reading the PR details from the event payload will give stale
  // data if for example the PR title has been updated. The event payload
  // contains data from when the workflow was originally triggered
  const prResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pullRequest.number}`,
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
    process.exitCode = 1
    return
  }

  const { title, labels }: { title: string; labels: { name: string }[] } =
    await prResponse.json()

  // Check if the PR title starts with conventional commit prefixes that should
  // skip label requirement
  const conventionalCommitPrefixes = [
    /^chore\([^)]+\)!?:/,
    /^feat\([^)]+\)!?:/,
    /^fix\([^)]+\)!?:/,
    /^docs\([^)]+\)!?:/,
  ]

  const shouldSkipLabelRequirement = conventionalCommitPrefixes.some((prefix) =>
    prefix.test(title),
  )

  if (shouldSkipLabelRequirement) {
    console.log(
      `PR title "${title}" starts with conventional commit prefix. Skipping ` +
        'release label requirement.',
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
        '- Add a ! after the scope for breaking changes, like "feat(scope)!: breaking change"',
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
