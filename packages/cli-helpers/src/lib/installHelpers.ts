import {
  addWorkspacePackages,
  addRootPackages as pmAddRootPackages,
  installPackages as pmInstallPackages,
} from '../packageManager/packages.js'

import { getPaths } from './paths.js'

export const addWebPackages = (webPackages: string[]) => ({
  title: `Adding required web packages...`,
  task: async () => {
    const cwd = getPaths().web.base
    await addWorkspacePackages('web', webPackages, { cwd })
  },
})

export const addApiPackages = (apiPackages: string[]) => ({
  title: 'Adding required api packages...',
  task: async () => {
    const cwd = getPaths().web.base
    await addWorkspacePackages('web', apiPackages, { cwd })
  },
})

export const addRootPackages = (packages: string[], devDependency = false) => {
  return {
    title: 'Installing packages...',
    task: async () => {
      const cwd = getPaths().base
      await pmAddRootPackages(packages, { cwd, dev: devDependency })
    },
  }
}

export const installPackages = {
  title: 'Installing packages...',
  task: async () => {
    const cwd = getPaths().base
    await pmInstallPackages({ cwd })
  },
}
