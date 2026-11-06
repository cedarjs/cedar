import fs from 'node:fs'

import { build, defaultBuildOptions } from '@cedarjs/framework-tools'

import { resolveCatalogRange } from '../../tasks/catalogs.mts'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8')) as {
  version: string
  devDependencies: Record<string, string>
}

if (!pkg.version) {
  throw new Error('build error: No version specified')
}

// `@prisma/client` is a devDependency: apps install their own copy, and this
// is the version Cedar is built and tested against
const prismaClientRange = pkg.devDependencies['@prisma/client']

if (!prismaClientRange) {
  throw new Error('build error: @prisma/client is not available')
}

// The range is `catalog:prisma`, which only means something inside the
// framework repo, so the version it stands for is embedded
const prismaClientVersion = resolveCatalogRange(
  '@prisma/client',
  prismaClientRange,
)

await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    packages: 'external',
    define: {
      __CEDAR_API_VERSION__: JSON.stringify(pkg.version),
      __PRISMA_CLIENT_VERSION__: JSON.stringify(prismaClientVersion),
    },
  },
})

// Place a package.json file with `type: module` in the dist folder so that
// all .js files are treated as ES Module files.
fs.writeFileSync('dist/package.json', JSON.stringify({ type: 'module' }))
