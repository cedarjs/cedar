import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

const rootPackageJsonPath = path.join(getPaths().base, 'package.json')
const packageJson = JSON.parse(
  await fs.promises.readFile(rootPackageJsonPath, 'utf8'),
)

if (!Array.isArray(packageJson.workspaces)) {
  console.log('Deprecated workspace config detected in ' + rootPackageJsonPath)
  console.log(
    'Please see https://github.com/cedarjs/cedar/releases/tag/v2.2.0 for ' +
      'more information.',
  )
}

const apiGeneratorTemplatesPath = path.join(getPaths().api.base, 'generators')
const webGeneratorTemplatesPath = path.join(getPaths().web.base, 'generators')

if (fs.existsSync(webGeneratorTemplatesPath)) {
  console.log(
    'Deprecated generator templates path detected at ' +
      webGeneratorTemplatesPath,
  )
  console.log(
    'Please see https://github.com/cedarjs/cedar/pull/813 for more ' +
      'information.',
  )
}

if (fs.existsSync(apiGeneratorTemplatesPath)) {
  console.log(
    'Deprecated generator templates path detected at ' +
      apiGeneratorTemplatesPath,
  )
  console.log(
    'Please see https://github.com/cedarjs/cedar/pull/813 for more ' +
      'information.',
  )
}

const dbTsPath = path.join(getPaths().api.lib, 'db.ts')
const dbJsPath = path.join(getPaths().api.lib, 'db.js')

const dbFilePath = fs.existsSync(dbTsPath)
  ? dbTsPath
  : fs.existsSync(dbJsPath)
    ? dbJsPath
    : null

const hasPrismaV7PrepExport =
  dbFilePath &&
  /export\s+\*\s+from\s+['"]@prisma\/client['"]/.test(
    fs.readFileSync(dbFilePath, 'utf8'),
  )

if (!hasPrismaV7PrepExport) {
  console.log(
    'After completing the upgrade to this Canary build of CedarJS we\n' +
      'recommend that you run the new Prisma v7 preparation codemod.\n',
  )
  console.log(
    'As the name implies, the codemod will prepare your codebase for the\n' +
      'Prisma v7 upgrade that will come in the next major version of\n' +
      'CedarJS. The codemod will add a new export of the Prisma client, and\n' +
      'updates all existing `@prisma/client` imports to use this new export.\n',
  )
  console.log(
    'The codemod is not required – you can keep doing the direct\n' +
      '`@prisma/client` import everywhere for now, but for Prisma v7 that\n' +
      'will not work anymore. We recommend doing the code change now, to\n' +
      'make the upgrade to the next major version of Cedar (and Prisma)\n' +
      'easier and lower risk.\n',
  )
  console.log(
    'Please run the following command after the upgrade has completed:',
  )
  console.log('  yarn dlx @cedarjs/codemods prisma-v7-prep')
}
