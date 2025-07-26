import path from 'node:path'

import fse from 'fs-extra'

import { getPaths } from '@cedarjs/project-config'

export const cleanWebBuild = () => {
  const rwjsPaths = getPaths()
  fse.removeSync(rwjsPaths.web.dist)
  fse.removeSync(path.join(rwjsPaths.generated.prebuild, 'web'))
}

interface BuildOptions {
  verbose?: boolean
}

/**
 * Builds the web side with Vite, but not used in the buildHandler currently
 * because we want to set the process.cwd to web.base
 */
export const buildWeb = async ({ verbose }: BuildOptions) => {
  // @NOTE: Using dynamic import, because vite is still opt-in
  const { build } = await import('vite')
  const viteConfig = getPaths().web.viteConfig

  if (process.cwd() !== getPaths().web.base) {
    throw new Error(
      'Looks like you are running the command from the wrong dir, this can lead to unintended consequences on CSS processing',
    )
  }

  if (!viteConfig) {
    throw new Error('Could not locate your web/vite.config.{js,ts} file')
  }

  return build({
    configFile: viteConfig,
    envFile: false,
    logLevel: verbose ? 'info' : 'warn',
  })
}
