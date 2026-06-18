/**
 * Detects if there are changes to CLI-related packages that affect
 * package-manager-agnostic behavior.
 *
 * @param {string[]} changedFiles The list of files which git has listed as changed
 * @returns {boolean} True if there are changes, false if not
 */
export function cliChanged(changedFiles) {
  for (const changedFile of changedFiles) {
    if (
      changedFile.startsWith('packages/cli/') ||
      changedFile.startsWith('packages/cli-helpers/')
    ) {
      console.log('CLI change detected:', changedFile)
      return true
    }
  }

  console.log('No CLI changes')
  return false
}
