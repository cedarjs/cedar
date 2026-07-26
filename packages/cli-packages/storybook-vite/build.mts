import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import fg from 'fast-glob'

import {
  build,
  defaultBuildOptions,
  defaultIgnorePatterns,
} from '@cedarjs/framework-tools'
import { generateTypesEsm } from '@cedarjs/framework-tools/generateTypes'

await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
  },
})

/**
 * We need template files, which esbuild won't copy over,
 * so we do it manually here.
 */
async function copyAssets() {
  const cliRootDirPath = path.dirname(fileURLToPath(import.meta.url))
  const cliSrcDirPath = path.join(cliRootDirPath, 'src')
  const cliDistDirPath = path.join(cliRootDirPath, 'dist')

  let pathnames = await fg(['**/*.template'], {
    absolute: true,
    cwd: cliSrcDirPath,
    ignore: defaultIgnorePatterns,
  })

  // For Windows.
  pathnames = pathnames.map((p) => path.normalize(p))

  for (const pathname of pathnames) {
    const distPathname = pathname.replace(cliSrcDirPath, cliDistDirPath)

    try {
      await fs.cp(pathname, distPathname)
    } catch (error) {
      console.error(
        `Couldn't copy ${pathname} to ${distPathname}. ` +
          `(Replaced ${cliSrcDirPath} with ${cliDistDirPath} to get the dist pathname.)`,
      )
      throw error
    }
  }
}

await copyAssets()

await generateTypesEsm()
