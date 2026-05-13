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
  const filesWithOldVar: string[] = []

  for await (const file of glob(patterns, { cwd: projectRoot, exclude })) {
    const content = await readFile(path.join(projectRoot, file), 'utf8')
    if (content.includes('RWJS_DELAY_RESTART')) {
      filesWithOldVar.push(file)
    }
  }

  if (filesWithOldVar.length > 0) {
    console.log(
      styleText('yellow', 'Deprecated env var detected: RWJS_DELAY_RESTART') +
        '\n',
    )
    console.log(
      'Found RWJS_DELAY_RESTART in: ' + filesWithOldVar.join(', ') + '\n',
    )
    console.log(
      'RWJS_DELAY_RESTART has been renamed to CEDAR_DELAY_API_RESTART and will\n' +
        'be removed in the next major release of CedarJS.\n',
    )
    console.log(
      'Please rename it in the files listed above before the next major upgrade.\n',
    )
  }
}

main()
