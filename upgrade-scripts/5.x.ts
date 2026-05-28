import { glob, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { styleText } from 'node:util'

import { getPaths } from '@cedarjs/project-config'

const projectRoot = getPaths().base

const patterns = [
  '**/*.{js,cjs,mjs,ts,cts,mts}',
  '**/.env',
  '**/.env.*',
  '**/*.sh',
  '**/*.py',
  '**/*.json',
  '**/*.{yaml,yml}',
  '**/Dockerfile',
  '**/Dockerfile.*',
  '**/docker-compose.{yml,yaml}',
  '**/.dockerignore',
  '**/*.tf',
  '**/*.tfvars',
  '**/*.bicep',
]

const exclude = ['**/node_modules/**', '**/dist/**']

async function main() {
  const filesWithOldDelayRestartVar: string[] = []
  const filesWithOldRedirectTelemetryVar: string[] = []
  const filesWithOldDisableTelemetryVar: string[] = []
  const filesWithOldVerboseTelemetryVar: string[] = []

  for await (const file of glob(patterns, { cwd: projectRoot, exclude })) {
    const content = await readFile(path.join(projectRoot, file), 'utf8')

    if (content.includes('RWJS_DELAY_RESTART')) {
      filesWithOldDelayRestartVar.push(file)
    }

    if (content.includes('REDWOOD_REDIRECT_TELEMETRY')) {
      filesWithOldRedirectTelemetryVar.push(file)
    }

    if (content.includes('REDWOOD_DISABLE_TELEMETRY')) {
      filesWithOldDisableTelemetryVar.push(file)
    }

    if (content.includes('REDWOOD_VERBOSE_TELEMETRY')) {
      filesWithOldVerboseTelemetryVar.push(file)
    }
  }

  if (filesWithOldDelayRestartVar.length > 0) {
    console.log(
      styleText('yellow', 'Deprecated env var detected: RWJS_DELAY_RESTART') +
        '\n',
    )
    console.log(
      'Found RWJS_DELAY_RESTART in: ' +
        filesWithOldDelayRestartVar.join(', ') +
        '\n',
    )
    console.log(
      'RWJS_DELAY_RESTART has been renamed to CEDAR_DELAY_API_RESTART and will\n' +
        'be removed in the next major release of CedarJS.\n',
    )
    console.log(
      'Please rename it in the files listed above before the next major upgrade.\n',
    )
  }

  if (filesWithOldRedirectTelemetryVar.length > 0) {
    console.log(
      styleText(
        'yellow',
        'Deprecated env var detected: REDWOOD_REDIRECT_TELEMETRY',
      ) + '\n',
    )
    console.log(
      'Found REDWOOD_REDIRECT_TELEMETRY in: ' +
        filesWithOldRedirectTelemetryVar.join(', ') +
        '\n',
    )
    console.log(
      'REDWOOD_REDIRECT_TELEMETRY has been renamed to CEDAR_REDIRECT_TELEMETRY and will\n' +
        'be removed in the next major release of CedarJS.\n',
    )
    console.log(
      'Please rename it in the files listed above before the next major upgrade.\n',
    )
  }

  if (filesWithOldDisableTelemetryVar.length > 0) {
    console.log(
      styleText(
        'yellow',
        'Deprecated env var detected: REDWOOD_DISABLE_TELEMETRY',
      ) + '\n',
    )
    console.log(
      'Found REDWOOD_DISABLE_TELEMETRY in: ' +
        filesWithOldDisableTelemetryVar.join(', ') +
        '\n',
    )
    console.log(
      'REDWOOD_DISABLE_TELEMETRY has been renamed to CEDAR_DISABLE_TELEMETRY and will\n' +
        'be removed in the next major release of CedarJS.\n',
    )
    console.log(
      'Please rename it in the files listed above before the next major upgrade.\n',
    )
  }

  if (filesWithOldVerboseTelemetryVar.length > 0) {
    console.log(
      styleText(
        'yellow',
        'Deprecated env var detected: REDWOOD_VERBOSE_TELEMETRY',
      ) + '\n',
    )
    console.log(
      'Found REDWOOD_VERBOSE_TELEMETRY in: ' +
        filesWithOldVerboseTelemetryVar.join(', ') +
        '\n',
    )
    console.log(
      'REDWOOD_VERBOSE_TELEMETRY has been renamed to CEDAR_VERBOSE_TELEMETRY and will\n' +
        'be removed in the next major release of CedarJS.\n',
    )
    console.log(
      'Please rename it in the files listed above before the next major upgrade.\n',
    )
  }
}

main()
