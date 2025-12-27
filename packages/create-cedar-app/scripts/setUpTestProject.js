/* eslint-env node */

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import Configstore from 'configstore'
import { cd, os, path, $ } from 'zx'

const config = new Configstore('create-cedar-app')
let projectPath = config.get('projectPath')

const projectExists = projectPath && fs.existsSync(projectPath)

if (!projectExists) {
  const [timestamp] = new Date().toISOString().replace(/-|:/g, '_').split('.')

  projectPath = path.join(os.tmpdir(), `crwa_${timestamp}`)

  await fs.promises.mkdir(projectPath, { recursive: true })
  await $`yarn --cwd ${projectPath} init -2`

  config.set('projectPath', projectPath)
}

const packagePath = fileURLToPath(new URL('../', import.meta.url))
const tarball = 'create-cedar-app.tgz'

await fs.promises.rename(
  path.join(packagePath, tarball),
  path.join(projectPath, tarball),
)

cd(projectPath)
await $`yarn add ./${tarball}`

console.log(projectPath)
