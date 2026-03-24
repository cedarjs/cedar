import {
  installPackagesTask,
  addWorkspacePackagesTask,
  addRootPackagesTask,
} from './packageManager/index.js'
import { getPaths } from './paths.js'

export const addWebPackages = (webPackages: string[]) =>
  addWorkspacePackagesTask('web', webPackages, false, getPaths().base)

export const addApiPackages = (apiPackages: string[]) =>
  addWorkspacePackagesTask('api', apiPackages, false, getPaths().base)

export const addRootPackages = (packages: string[], devDependency = false) =>
  addRootPackagesTask(packages, devDependency, getPaths().base)

export const installPackages = installPackagesTask(getPaths().base)
