import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

const apiGeneratorTemplatesPath = path.join(getPaths().api.base, 'generators')
const webGeneratorTemplatesPath = path.join(getPaths().web.base, 'generators')

if (fs.existsSync(webGeneratorTemplatesPath)) {
  console.log(
    'Deprecated generator templates detected at ' + webGeneratorTemplatesPath,
  )
  console.log(
    'Please see https://github.com/cedarjs/cedar/pull/813 for more ' +
      'information.',
  )
}

if (fs.existsSync(apiGeneratorTemplatesPath)) {
  console.log(
    'Deprecated generator templates detected at ' + apiGeneratorTemplatesPath,
  )
  console.log(
    'Please see https://github.com/cedarjs/cedar/pull/813 for more ' +
      'information.',
  )
}
