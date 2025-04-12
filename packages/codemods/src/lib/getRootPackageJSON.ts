import fs from 'fs'
import path from 'path'

import { getPaths } from '@redmix/project-config'

const getRootPackageJSON = () => {
  const rootPackageJSONPath = path.join(getPaths().base, 'package.json')

  const rootPackageJSON = JSON.parse(
    fs.readFileSync(rootPackageJSONPath, 'utf8'),
  )

  return [rootPackageJSON, rootPackageJSONPath]
}

export default getRootPackageJSON
