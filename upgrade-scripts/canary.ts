import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

const rootPackageJsonPath = path.join(getPaths().base, 'package.json')
const packageJson = JSON.parse(
  await fs.promises.readFile(rootPackageJsonPath, 'utf8'),
)

if (!Array.isArray(packageJson.workspaces)) {
  console.log('Deprecated workspace config detected in ' + rootPackageJsonPath)
  console.log(
    'Please see https://github.com/cedarjs/cedar/releases/tag/v2.2.0 for ' +
      'more information.',
  )
}
