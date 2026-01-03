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

export function workspaces({ includePackages = false } = {}) {
  const cedarPaths = getPaths()

  let workspaces = []

  if (fs.existsSync(path.join(cedarPaths.web.base, 'package.json'))) {
    workspaces = [...workspaces, 'web']
  }

  if (fs.existsSync(path.join(cedarPaths.api.base, 'package.json'))) {
    workspaces = [...workspaces, 'api']
  }

  if (includePackages) {
    // fs.globSync requires forward slashes as path separators in patterns,
    // even on Windows.
    const globPattern = path
      .join(cedarPaths.packages, '*')
      .replaceAll('\\', '/')
    // TODO: See if we can make this async
    const allPackagePaths = fs.globSync(globPattern)

    workspaces = [
      ...workspaces,
      'packages/*',
      ...allPackagePaths.map((p) => p.split('/').at(-1)),
      ...allPackagePaths.map((p) => p.split('/').slice(-2).join('/')),
      ...allPackagePaths.map((p) => {
        const packageJsonPath = path.join(p, 'package.json')
        return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).name
      }),
    ]
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
