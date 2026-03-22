import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

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

const prismaSchemaPath = path.join(getPaths().api.base, 'db', 'schema.prisma')
const prismaConfigPath = getPaths().api.prismaConfig

if (fs.existsSync(prismaSchemaPath) && fs.existsSync(prismaConfigPath)) {
  const schema = fs.readFileSync(prismaSchemaPath, 'utf-8')
  const prismaConfig = fs.readFileSync(prismaConfigPath, 'utf-8')

  const hasOldProvider = /provider\s*=\s*"prisma-client-js"/.test(schema)
  const uncommentedConfig = prismaConfig
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n')
  const hasDatasourceUrl =
    uncommentedConfig.includes('datasource: {') &&
    uncommentedConfig.includes('url: ')

  if (hasOldProvider && !hasDatasourceUrl) {
    console.log(
      "Don't forget to run the Prisma v7 codemod after completing the upgrade",
    )
    console.log('  `yarn dlx @cedarjs/codemods prisma-v7`')
  }
}
