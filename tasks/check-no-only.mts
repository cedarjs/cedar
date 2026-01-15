import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import process from 'node:process'

/**
 * Check for .only presence in test files
 * Vitest will fail in CI if it detects .only in test files. To get faster
 * feedback, we run this script as a pre-push hook.
 */
async function check() {
  let files: string[] = []

  // Try to get changed files relative to origin/main
  const gitOutput = execSync('git diff --name-only origin/main', {
    encoding: 'utf-8',
    // Ignore stderr to avoid noise if it fails
    stdio: ['pipe', 'pipe', 'ignore'],
  })

  const changedFiles = gitOutput.split('\n').filter(Boolean)

  // Filter for test files
  files = changedFiles
    .map((f) => f.replace(/\\/g, '/'))
    .filter((file) => {
      return (
        file.startsWith('packages/') &&
        /\.(test|spec|scenario)\./.test(file) &&
        existsSync(file)
      )
    })

  let exitCode = 0

  for (const file of files) {
    try {
      const content = await readFile(file, 'utf-8')
      const lines = content.split('\n')

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (/^\s*\w+\.*only\(/.test(line)) {
          console.error(`${file}:${i + 1}: ${line.trim()}`)
          exitCode = 1
        }
      }
    } catch (err) {
      console.error(`Error reading file ${file}:`, err)
      exitCode = 1
    }
  }

  process.exit(exitCode)
}

check()
