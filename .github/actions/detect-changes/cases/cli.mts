/**
 * Detects if there are changes to CLI-related packages that affect
 * package-manager-agnostic behavior.
 *
 * @param changedFiles The list of files which git has listed as changed
 * @returns True if there are changes, false if not
 */
export function cliChanged(changedFiles: string[]): boolean {
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
