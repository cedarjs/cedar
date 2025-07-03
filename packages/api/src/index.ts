import { createRequire } from 'node:module'
import path from 'node:path'

export * from './auth/index.js'
export * from './errors.js'
export * from './validations/validations.js'
export * from './validations/errors.js'
export * from './types.js'
export * from './transforms.js'
export * from './cors.js'
export * from './event.js'

const customRequire =
  // Look out for a stubbed require function
  // @ts-expect-error - Using `0, ` to work around bundler magic
  typeof require === 'function' && !(0, require).toString().includes('@rollup')
    ? require
    : // The argument to `createRequire` should be a file and node will strip
      // the last segment (the file name) to get to a base path. By appending a
      // fake "foo" file we get the base path we want.
      // If I knew this was only going to be run as an ESM I'd use
      // `import.meta.url`, but for dual bundling I can't do that (without a
      // bunch of warnings at build time at least)
      createRequire(path.join(process.env.RWJS_CWD || process.cwd(), 'foo'))

const rxApiPath = customRequire.resolve('@cedarjs/api')
const rxApiRequire = createRequire(rxApiPath)

let packageJson = rxApiRequire('./package.json')

// Because of how we build the package we might have to walk up the directory
// tree a few times to find the correct package.json file
if (packageJson?.name !== '@cedarjs/api') {
  packageJson = rxApiRequire('../package.json')
}

if (packageJson?.name !== '@cedarjs/api') {
  packageJson = rxApiRequire('../../package.json')
}

export const prismaVersion = packageJson?.dependencies['@prisma/client']
export const redwoodVersion = packageJson?.version
export const cedarjsVersion = packageJson?.version
