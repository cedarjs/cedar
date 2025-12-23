import fs from 'fs'
import path from 'path'

import { getPaths } from '@cedarjs/project-config'

async function moveGeneratorTemplates() {
  const apiGeneratorsOld = path.join(getPaths().base, 'api', 'generators')
  const webGeneratorsOld = path.join(getPaths().base, 'web', 'generators')

  const generatorsDir = path.join(getPaths().base, 'generators')

  const move = (oldPath: string, newPath: string) => {
    if (fs.existsSync(oldPath)) {
      fs.mkdirSync(path.dirname(newPath), { recursive: true })
      // We use copy and remove to be safe across partitions and to act recursively
      fs.cpSync(oldPath, newPath, { recursive: true })
      fs.rmSync(oldPath, { recursive: true, force: true })
    }
  }

  move(apiGeneratorsOld, path.join(generatorsDir, 'api'))
  move(webGeneratorsOld, path.join(generatorsDir, 'web'))
}

export default moveGeneratorTemplates
