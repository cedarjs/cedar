import { glob, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { styleText } from 'node:util'

import { getPaths } from '@cedarjs/project-config'

const projectRoot = getPaths().base

const patterns = ['**/*.{js,cjs,mjs,ts,cts,mts}']

const exclude = ['**/node_modules/**', '**/dist/**']

async function main() {
  const filesWithOldName: string[] = []

  for await (const file of glob(patterns, { cwd: projectRoot, exclude })) {
    const content = await readFile(path.join(projectRoot, file), 'utf8')

    if (content.includes('RedwoodGraphQLError')) {
      filesWithOldName.push(file)
    }
  }

  if (filesWithOldName.length > 0) {
    console.log(
      styleText('yellow', 'Deprecated API detected: RedwoodGraphQLError') +
        '\n',
    )
    console.log(
      'Found RedwoodGraphQLError in: ' + filesWithOldName.join(', ') + '\n',
    )
    console.log(
      'RedwoodGraphQLError has been renamed to CedarGraphQLError and will\n' +
        'be removed in the next major release of CedarJS.\n',
    )
    console.log(
      'Please rename it in the files listed above before the next major upgrade.\n',
    )
  }
}

main()
