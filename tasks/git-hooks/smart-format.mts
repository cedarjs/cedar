#!/usr/bin/env node

/**
 * Smart formatter – only applies proseWrap: always to brand new markdown files
 * (not tracked in HEAD). Existing files get the default prettier config
 * (proseWrap: preserve).
 *
 * Usage: node tasks/git-hooks/smart-format.mts <file> [<file> ...]
 */

import { spawnSync } from 'node:child_process'
import type { SpawnSyncOptions } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { dim } from 'ansis'

const mdGlobs = /\.(md|mdx)$/i

function isNewFile(file: string): boolean {
  const result = spawnSync('git', ['cat-file', '-e', `HEAD:${file}`], {
    stdio: 'ignore',
  })

  return result.status !== 0
}

// Just using `spawnSync` with plain 'yarn' fails on Windows:
//   [smart-format] yarn exited with status null
//   command: yarn prettier --write --log-level=silent C:\Users\RUNNER~1\AppData\Local\Temp\smart-format-test-Dk0Npf\hello world.ts
//   stderr: <no stderr>
//   error: spawnSync yarn ENOENT
function runYarn(args: string[]) {
  const yarnCmd =  process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
  const result = spawnSync(yarnCmd, args, {
    stdio: ['inherit', 'inherit', 'pipe'],
  } satisfies SpawnSyncOptions)

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() || '<no stderr>'
    const spawnError = result.error?.message || ''
    console.error(
      `[smart-format] yarn exited with status ${result.status ?? 'null'}\n` +
        `  command: ${yarnCmd} ${args.join(' ')}\n` +
        `  stderr: ${stderr}\n` +
        `  error: ${spawnError}`,
    )
    process.exit(result.status ?? 1)
  }
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

    runYarn(
      [
        'prettier',
        '--write',
        '--log-level=silent',
        '--prose-wrap',
        'always',
        ...newMdFiles,
      ],
    )
  }

  if (existingFiles.length > 0) {
    runYarn(
      ['prettier', '--write', '--log-level=silent', ...existingFiles],
    )
  }
}
