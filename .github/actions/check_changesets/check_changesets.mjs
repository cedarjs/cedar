import { getInput } from '@actions/core'
import { exec, getExecOutput } from '@actions/exec'
import github from '@actions/github'

const env = {
  GITHUB_EVENT_PATH: process.env.GITHUB_EVENT_PATH || '',
}

async function main() {
  // If the PR has the "changesets-ok" label, just pass.
  const { labels } = JSON.parse(getInput('labels'))
  const hasChangesetsOkLabel = labels.some(
    (label) => label.name === 'changesets-ok',
  )
  if (hasChangesetsOkLabel) {
    console.log('Skipping check because of the "changesets-ok" label')
    return
  }

  // Skip check if the PR is created by renovate
  const { user } = github.context.payload.pull_request
  const renovateUsernames = ['renovate[bot]', 'renovate-bot', 'renovate']
  if (user && renovateUsernames.includes(user.login)) {
    console.log('Skipping check because the PR is created by', user.login)
    return
  }

  const event = fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf-8')

  /** @type {GitHubEvent} */
  const {
    pull_request: { title },
  } = JSON.parse(event)

  // Check if the PR title starts with conventional commit prefixes that should
  // skip label requirement
  const conventionalCommitPrefixes = [
    /^chore\([^)]+\):/,
    /^feat\([^)]+\):/,
    /^fix\([^)]+\):/,
    /^docs\([^)]+\):/,
  ]

  const shouldSkipChangesetsRequirement = conventionalCommitPrefixes.some(
    (prefix) => prefix.test(title),
  )

  if (shouldSkipChangesetsRequirement) {
    console.log(
      `PR title "${title}" starts with conventional commit prefix. Skipping ` +
        'changesets requirement.',
    )
    return
  }

  // We only enforce changesets on PRs that are not marked as "chore" or "SSR" or "RSC"
  const skipOnMilestone = ['chore', 'SSR', 'RSC']
  const { milestone } = github.context.payload.pull_request
  if (milestone && skipOnMilestone.includes(milestone.title)) {
    console.log(`Skipping check because of the "${milestone.title}" milestone`)
    return
  }

  // Check if the PR adds a changeset.
  await exec('git fetch origin main', [], { silent: true })
  const { stdout } = await getExecOutput(
    'git diff origin/main --name-only',
    [],
    { silent: true },
  )
  const changedFiles = stdout.toString().trim().split('\n').filter(Boolean)
  const addedChangeset = changedFiles.some((file) =>
    file.startsWith('.changesets/'),
  )
  if (addedChangeset) {
    // Empty space here (and in subsequent `console.log`s) for formatting in the action.
    console.log(['', 'Added a changeset'].join('\n'))

    return
  }

  const pr = github.context.payload.pull_request
  console.log(
    [
      '',
      '📝 Consider adding a changeset',
      '==============================',
      '',
      'If this is a user-facing PR (a feature or a fix), it should probably have a changeset.',
      `Run \`yarn changesets ${pr.number}\` to create a changeset for this PR.`,
      "If it doesn't need one (it's a chore), you can add the 'changesets-ok' label.",
    ].join('\n'),
  )

  process.exitCode = 1
}

main()
