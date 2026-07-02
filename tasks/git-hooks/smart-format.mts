#!/usr/bin/env node

/**
 * Smart formatter – only applies proseWrap: always to brand new markdown files
 * (not tracked in HEAD). Existing files get the default prettier config
 * (proseWrap: preserve).
 *
 * Usage: node tasks/git-hooks/smart-format.mts <file> [<file> ...]
 */

import { spawnSync } from 'node:child_process'

import { dim } from 'ansis'

import { execAsync } from './utils.mts'

const mdGlobs = /\.(md|mdx)$/i

function isNewFile(file: string): boolean {
  const result = spawnSync('git', ['cat-file', '-e', `HEAD:${file}`], {
    stdio: 'ignore',
  })

  return result.status !== 0
}

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

const numNewFiles = newMdFiles.length

if (numNewFiles > 0) {
  const logMsg = `Applying \`proseWrap: always\` to ${numNewFiles} new markdown file(s)...`
  console.log(dim(logMsg))

  await execAsync(
    'yarn',
    [
      'prettier',
      '--write',
      '--log-level=silent',
      '--prose-wrap',
      'always',
      ...newMdFiles,
    ],
    'smart-format',
  )
}

if (existingFiles.length > 0) {
  await execAsync(
    'yarn',
    ['prettier', '--write', '--log-level=silent', ...existingFiles],
    'smart-format',
  )
}
