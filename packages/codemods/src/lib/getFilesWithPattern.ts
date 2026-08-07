/**
 * Searches the given directories for files containing `substring`, returning
 * the paths of the files that contain it.
 */
import fs from 'node:fs'
import path from 'node:path'

const getFilesWithPattern = ({
  substring,
  filesToSearch,
}: {
  substring: string
  filesToSearch: string[]
}) => {
  const found: string[] = []

  for (const root of filesToSearch) {
    if (!fs.existsSync(root)) {
      continue
    }

    const entries = fs.globSync('**/*', {
      cwd: root,
      withFileTypes: true,
      exclude: ['**/node_modules/**'],
    })

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue
      }

      const filePath = path.join(entry.parentPath, entry.name)

      try {
        const contents = fs.readFileSync(filePath, 'utf8')
        if (contents.includes(substring)) {
          found.push(filePath)
        }
      } catch {
        // Skip files that can't be read.
      }
    }
  }

  return found
}

export default getFilesWithPattern
