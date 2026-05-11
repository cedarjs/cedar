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

import { execSync } from 'node:child_process'

import { dim } from 'ansis'

const args = process.argv.slice(2)

if (args.length === 0) {
  process.exit(0)
}

const mdGlobs = /\.(md|mdx)$/i

function isNewFile(file: string): boolean {
  try {
    execSync(`git cat-file -e HEAD:"${file}"`, { stdio: 'ignore' })
    return false
  } catch {
    return true
  }
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

// Run prettier with proseWrap only on new markdown files

if (newMdFiles.length > 0) {
  console.log(
    dim(`Applying proseWrap: always to ${newMdFiles.length} new markdown file(s)…`),
  )
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
  return files.map((f) => `'${f}'`).join(' ')
}
