import fs from 'node:fs'
import path from 'path'

import { parseConfigFileTextToJson } from 'typescript'

import { getPaths, resolveFile } from '@cedarjs/project-config'

export const getTsConfigs = () => {
  const rwPaths = getPaths()
  const apiTsConfigPath = path.join(rwPaths.api.base, 'tsconfig.json')
  const webTsConfigPath = path.join(rwPaths.web.base, 'tsconfig.json')

  const apiTsConfig = fs.existsSync(apiTsConfigPath)
    ? parseConfigFileTextToJson(
        apiTsConfigPath,
        fs.readFileSync(apiTsConfigPath, 'utf-8'),
      )
    : null

  const webTsConfig = fs.existsSync(webTsConfigPath)
    ? parseConfigFileTextToJson(
        webTsConfigPath,
        fs.readFileSync(webTsConfigPath, 'utf-8'),
      )
    : null

  return {
    api: apiTsConfig?.config ?? null,
    web: webTsConfig?.config ?? null,
  }
}

export const isTypeScriptProject = () => {
  const paths = getPaths()
  return (
    fs.existsSync(path.join(paths.web.base, 'tsconfig.json')) ||
    fs.existsSync(path.join(paths.api.base, 'tsconfig.json'))
  )
}

export const isServerFileSetup = () => {
  const serverFilePath = path.join(
    getPaths().api.src,
    `server.${isTypeScriptProject() ? 'ts' : 'js'}`,
  )

  return fs.existsSync(serverFilePath)
}

export const isRealtimeSetup = () => {
  const realtimePath = path.join(
    getPaths().api.lib,
    `realtime.${isTypeScriptProject() ? 'ts' : 'js'}`,
  )

  return fs.existsSync(realtimePath)
}

// TODO: Remove this in a future minor release. It should not be needed. The
// re-export it detects should always be present in CedarJS v7 and later.
export const dbReexportsPrismaClient = () => {
  const dbPath = resolveFile(path.join(getPaths().api.lib, 'db'))

  if (!dbPath) {
    return false
  }

  const content = fs.readFileSync(dbPath, 'utf-8')

  // Find PrismaClient import.
  // It can look like this:
  // import { PrismaClient } from 'api/db/generated/prisma/client.mts'
  // But can also be a multi-line import:
  // import {
  //   Member,
  //   Price,
  //   PrismaClient,
  //   Store,
  // } from 'api/db/generated/prisma/client.mts'
  const prismaClientImportMatch = content.match(
    /import\s+{[^}]*\bPrismaClient\b[^}]*}\s+from\s+['"](.*?)['"]/,
  )
  const prismaClientLocation = prismaClientImportMatch?.[1]

  return new RegExp(
    // @ts-expect-error - old types
    `export \\* from ['"]${RegExp.escape(prismaClientLocation)}['"]`,
  ).test(content)
}
