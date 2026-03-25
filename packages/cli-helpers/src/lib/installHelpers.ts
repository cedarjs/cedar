import execa from 'execa'

import { getPackageManager } from '@cedarjs/project-config/packageManager'

import { add } from '../packageManager/index.js'

import { getPaths } from './paths.js'

export const addWebPackages = (webPackages: string[]) => ({
  title: 'Adding required web packages...',
  task: async () => {
    const pm = getPackageManager()
    await execa(pm, [add(), ...webPackages], { cwd: getPaths().web.base })
  },
})

export const addApiPackages = (apiPackages: string[]) => ({
  title: 'Adding required api packages...',
  task: async () => {
    const pm = getPackageManager()
    await execa(pm, [add(), ...apiPackages], { cwd: getPaths().api.base })
  },
})

export const addRootPackages = (packages: string[], devDependency = false) => {
  const addMode = devDependency ? [add(), '-D'] : [add()]
  return {
    title: 'Installing packages...',
    task: async () => {
      const pm = getPackageManager()
      await execa(pm, [...addMode, ...packages], { cwd: getPaths().base })
    },
  }
}

export const installPackages = {
  title: 'Installing packages...',
  task: async () => {
    const pm = getPackageManager()
    await execa(pm, ['install'], { cwd: getPaths().base })
  },
}
