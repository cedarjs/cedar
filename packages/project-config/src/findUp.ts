import fs from 'node:fs'
import path from 'path'

/**
 * Find a file by walking up parent directories.
 */
export function findUp(
  file: string | string[],
  startingDirectory: string = process.cwd(),
): string | null {
  const files = Array.isArray(file) ? file : [file]

  for (const f of files) {
    const possibleFilepath = path.join(startingDirectory, f)
    if (fs.existsSync(possibleFilepath)) {
      return possibleFilepath
    }
  }

  const parentDirectory = path.dirname(startingDirectory)

  // If we've reached the root directory, there's no file to be found.
  if (parentDirectory === startingDirectory) {
    return null
  }

  return findUp(file, parentDirectory)
}
