#!/usr/bin/env node

/**
 * Smart formatter — only applies proseWrap: always to brand new markdown
 * files (not tracked in HEAD). Existing files get the default prettier
 * config (proseWrap: preserve).
 *
 * Usage: node tasks/smart-format.mts <file> [<file> ...]
 *
 * Expects to receive a list of staged files from lefthook.
 */

import { execSync, spawnSync } from 'node:child_process'

import { dim } from 'ansis'

const args = process.argv.slice(2)

if (args.length === 0) {
  process.exit(0)
}

const mdGlobs = /\.(md|mdx)$/i

function isNewFile(file: string): boolean {
  const result = spawnSync('git', ['cat-file', '-e', `HEAD:${file}`], {
    stdio: 'ignore',
  })

  return result.status !== 0
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
    `yarn prettier --write --log-level=silent --prose-wrap always ${quoteAll(newMdFiles)}`,
    { stdio: 'inherit' },
  )
}

if (existingFiles.length > 0) {
  execSync(
    `yarn prettier --write --log-level=silent ${quoteAll(existingFiles)}`,
    { stdio: 'inherit' },
  )
}

function quoteAll(files: string[]): string {
  return files.map((f) => `'${f.replaceAll("'", `'\\''`)}'`).join(' ')
}
