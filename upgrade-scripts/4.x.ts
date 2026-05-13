import fs from 'node:fs'
import path from 'node:path'
import { styleText } from 'node:util'

import { getPaths } from '@cedarjs/project-config'

const envFiles = [
  '.env',
  '.env.defaults',
  '.env.production',
  '.env.local',
  '.env.development',
  '.env.test',
]

const projectRoot = getPaths().base

const filesWithOldVar = envFiles.filter((file) => {
  const fullPath = path.join(projectRoot, file)
  return (
    fs.existsSync(fullPath) &&
    fs.readFileSync(fullPath, 'utf8').includes('RWJS_DELAY_RESTART')
  )
})

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
