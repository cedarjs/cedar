import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

async function moveGeneratorTemplates() {
  const apiGeneratorsOld = path.join(getPaths().api.base, 'generators')
  const webGeneratorsOld = path.join(getPaths().web.base, 'generators')

  const generatorsDir = path.join(getPaths().base, 'generatorTemplates')

  const move = (oldPath: string, newPath: string) => {
    if (fs.existsSync(oldPath)) {
      fs.mkdirSync(path.dirname(newPath), { recursive: true })
      fs.cpSync(oldPath, newPath, { recursive: true })
      fs.rmSync(oldPath, { recursive: true, force: true })
    }
  }

  move(apiGeneratorsOld, path.join(generatorsDir, 'api'))
  move(webGeneratorsOld, path.join(generatorsDir, 'web'))
}

export default moveGeneratorTemplates
