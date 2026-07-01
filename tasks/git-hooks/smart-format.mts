#!/usr/bin/env node

/**
 * Smart formatter – only applies proseWrap: always to brand new markdown files
 * (not tracked in HEAD). Existing files get the default prettier config
 * (proseWrap: preserve).
 *
 * Usage: node tasks/git-hooks/smart-format.mts <file> [<file> ...]
 */

import { execSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { dim } from 'ansis'

const mdGlobs = /\.(md|mdx)$/i

function isNewFile(file: string): boolean {
  const result = spawnSync('git', ['cat-file', '-e', `HEAD:${file}`], {
    stdio: 'ignore',
  })

  return result.status !== 0
}

// ---------------------------------------------------------------------------
// Guard: only run the main logic when executed directly (not imported)
// ---------------------------------------------------------------------------
const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isMainModule) {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    process.exit(0)
  }

  const newMdFiles: string[] = []
  const existingFiles: string[] = []

  for (const file of args) {
    if (mdGlobs.test(file) && isNewFile(file)) {
      newMdFiles.push(file)
    } else {
      existingFiles.push(file)
    }
  }

  if (newMdFiles.length > 0) {
    const logMsg =
      `Applying \`proseWrap: always\` to ${newMdFiles.length} new markdown ` +
      'file(s)...'
    console.log(dim(logMsg))

    execSync(
      'yarn',
      ['prettier', '--write', '--log-level=silent', '--prose-wrap', 'always', ...newMdFiles],
      { stdio: 'inherit' },
    )
  }

  if (existingFiles.length > 0) {
    execSync(
      'yarn',
      ['prettier', '--write', '--log-level=silent', ...existingFiles],
      { stdio: 'inherit' },
    )
  }
}
