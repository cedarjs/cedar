#!/usr/bin/env node

/**
 * Smart formatter – only applies proseWrap: always to brand new markdown files
 * (not tracked in HEAD). Existing files get the default prettier config
 * (proseWrap: preserve).
 *
 * Usage: node tasks/git-hooks/smart-format.mts <file> [<file> ...]
 */

import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { dim } from 'ansis'

const mdGlobs = /\.(md|mdx)$/i

function isNewFile(file: string): boolean {
  const result = spawnSync('git', ['cat-file', '-e', `HEAD:${file}`], {
    stdio: 'ignore',
  })

  return result.status !== 0
}

function resolveYarn() {
  const envPath = process.env.npm_execpath

  if (!envPath) {
    return { command: 'yarn', args: [] as string[] }
  }

  const ext = path.extname(envPath).toLowerCase()

  if (ext === '.cmd') {
    return { command: envPath, args: [] as string[] }
  }

  // .js / .mjs / .cjs – on Windows we need the .cmd sibling or node
  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    let exists = false
    try {
      exists = statSync(`${envPath}.cmd`).isFile()
    } catch {
      // file doesn't exist
    }

    if (process.platform === 'win32' && exists) {
      return { command: `${envPath}.cmd`, args: [] as string[] }
    }

    return { command: process.execPath, args: [envPath] }
  }

  return { command: envPath, args: [] as string[] }
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

    const { command: yarnCmd, args: yarnArgs } = resolveYarn()

    const newResult = spawnSync(
      yarnCmd,
      [
        ...yarnArgs,
        'prettier',
        '--write',
        '--log-level=silent',
        '--prose-wrap',
        'always',
        ...newMdFiles,
      ],
      { stdio: 'inherit' },
    )

    if (newResult.status !== 0) {
      process.exit(newResult.status ?? 1)
    }
  }

  if (existingFiles.length > 0) {
    const { command: yarnCmd, args: yarnArgs } = resolveYarn()

    const existingResult = spawnSync(
      yarnCmd,
      [
        ...yarnArgs,
        'prettier',
        '--write',
        '--log-level=silent',
        ...existingFiles,
      ],
      { stdio: 'inherit' },
    )

    if (existingResult.status !== 0) {
      process.exit(existingResult.status ?? 1)
    }
  }
}
