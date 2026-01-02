import fs from 'node:fs'
import path from 'path'

import { getPaths } from './index.js'

export const isTypeScriptProject = () => {
  const paths = getPaths()
  return (
    fs.existsSync(path.join(paths.web.base, 'tsconfig.json')) ||
    fs.existsSync(path.join(paths.api.base, 'tsconfig.json'))
  )
}

export const workspaces = () => {
  const paths = getPaths()

  let workspaces = []

  if (fs.existsSync(path.join(paths.web.base, 'package.json'))) {
    workspaces = [...workspaces, 'web']
  }

  if (fs.existsSync(path.join(paths.api.base, 'package.json'))) {
    workspaces = [...workspaces, 'api']
  }

  return workspaces
}

export const serverFileExists = () => {
  const serverFilePath = path.join(
    getPaths().api.src,
    `server.${isTypeScriptProject() ? 'ts' : 'js'}`,
  )

  return fs.existsSync(serverFilePath)
}
