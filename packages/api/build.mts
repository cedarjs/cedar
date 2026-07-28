import fs from 'node:fs'

import { build, defaultBuildOptions } from '@cedarjs/framework-tools'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8')) as {
  version: string
  dependencies: Record<string, string>
}

if (!pkg.version) {
  throw new Error('build error: No version specified')
}

if (!pkg.dependencies['@prisma/client']) {
  throw new Error('build error: @prisma/client is not available')
}

await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    packages: 'external',
    define: {
      __CEDAR_API_VERSION__: JSON.stringify(pkg.version),
      __PRISMA_CLIENT_VERSION__: JSON.stringify(
        pkg.dependencies?.['@prisma/client'],
      ),
    },
  },
})

// Place a package.json file with `type: module` in the dist folder so that
// all .js files are treated as ES Module files.
fs.writeFileSync('dist/package.json', JSON.stringify({ type: 'module' }))
