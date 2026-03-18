/** Detects if the given file path points to a docs file */
function isDocsFile(filePath) {
  if (filePath.startsWith('docs')) {
    return true
  }

  if (
    [
      'CHANGELOG.md',
      'CODE_OF_CONDUCT.md',
      'CONTRIBUTING.md',
      'CONTRIBUTORS.md',
      'LICENSE',
      'README.md',
      'SECURITY.md',
    ].includes(filePath)
  ) {
    return true
  }

  return false
}

/**
 * Checks if the given filepath points to a markdown file in the
 * /.changesets/ directory
 */
export function isChangesetsFile(filePath) {
  return /^\.changesets\/.*\.md/.test(filePath)
}

function isNonCodeWorkflowOrAction(filePath) {
  const nonCodeWorkflowsOrActions = [
    '.github/workflows/check-changelog.yml',
    '.github/actions/check_changesets/check_changesets.mjs',
    '.github/actions/check_changesets/action.yml',
    '.github/actions/check_changesets/package.json',
    '.github/actions/check_changesets/yarn.lock',

    '.github/workflows/publish-canary.yml',
    '.github/scripts/publish_canary.sh',

    '.github/workflows/publish-release-candidate.yml',
    '.github/scripts/publish-release-candidate.mts',

    '.github/workflows/require-milestone.yml',
    '.github/actions/require-milestone/action.yml',
    '.github/actions/requireMilestone.mjs',

    '.github/workflows/require-release-label.yml',
    '.github/actions/require-release-label-or-cc-message/action.yml',
    '.github/actions/require-release-label-or-cc-message/requireReleaseLabelOrCcMessage.mts',

    '.github/workflows/scorecard.yml',
    '.github/workflows/stale.yml',
  ]
  return nonCodeWorkflowsOrActions.includes(filePath)
}

/**
 * Checks if the given array of file paths contains any framework code files
 */
export function codeChanges(changedFiles) {
  return changedFiles.some((file) => {
    if (
      !isDocsFile(file) &&
      !isChangesetsFile(file) &&
      !isNonCodeWorkflowOrAction(file)
    ) {
      console.log(`Found potential code file: ${file}`)
      return true
    }

    return false
  })
}
