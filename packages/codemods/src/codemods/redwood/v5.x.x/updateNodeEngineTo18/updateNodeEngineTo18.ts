import fs from 'node:fs'
import path from 'path'

import { getPaths } from '@cedarjs/project-config'

async function updateNodeEngineTo18() {
  const packageJSONPath = path.join(getPaths().base, 'package.json')
  const packageJSON = JSON.parse(fs.readFileSync(packageJSONPath, 'utf-8'))

  packageJSON.engines.node = '=18.x'

  fs.writeFileSync(packageJSONPath, JSON.stringify(packageJSON, null, 2))
}

export { updateNodeEngineTo18 }
