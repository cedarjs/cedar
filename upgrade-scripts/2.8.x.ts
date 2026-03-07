import fs from 'node:fs'
import path from 'node:path'
import { styleText } from 'node:util'

import { getPaths } from '@cedarjs/project-config'

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
    'After completing the upgrade to Cedar v2.8.x we recommend you run the\n' +
      'new Prisma v7 preparation codemod:\n' +
      '`yarn dlx @cedarjs/codemods prisma-v7-prep`\n',
  )
  console.log(
    'As the name implies, the codemod will prepare your codebase for the\n' +
      'Prisma v7 upgrade that will come in the next major version of\n' +
      'CedarJS. The codemod will add a new export of the Prisma client, and\n' +
      'updates all existing `@prisma/client` imports to use this new export.\n',
  )
  console.log(
    'The codemod is not required – you can keep doing the direct\n' +
      '`@prisma/client` import everywhere for now. But for Prisma v7 that\n' +
      'will not work anymore. We recommend doing the code change now, to\n' +
      'make the upgrade to the next major version of Cedar (and Prisma)\n' +
      'easier and lower risk.\n',
  )
  console.log(
    styleText('yellow', 'TL;DR:') + ' Please run the following command:\n',
  )
  console.log('  yarn dlx @cedarjs/codemods prisma-v7-prep')
}
