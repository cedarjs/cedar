import fs from 'node:fs'
import path from 'node:path'

import { getSchemaPath, getPaths } from '@cedarjs/project-config'

export type UpdateSchemaFileResult = {
  status: 'skipped' | 'updated' | 'unmodified'
  warnings: string[]
}

const NEW_GENERATOR_BLOCK = `generator client {
  provider               = "prisma-client"
  output                 = "./generated/prisma"
  moduleFormat           = "cjs"
  generatedFileExtension = "mts"
  importFileExtension    = "mts"
}`

/**
 * Returns true if the schema already uses the Prisma v7 generator format.
 */
function isAlreadyMigrated(source: string): boolean {
  return /generator\s+client\s*\{[^}]*provider\s*=\s*["']prisma-client["'][^}]*\}/.test(
    source,
  )
}

/**
 * Remove `url` and `directUrl` lines from the datasource block and replace
 * the generator client block with the Prisma v7 format. Returns the
 * transformed source string along with any warnings to surface to the user.
 */
function transformSchema(source: string): {
  result: string
  directUrlEnvVar: string | null
  customBinaryTargets: string | null
} {
  let directUrlEnvVar: string | null = null
  let customBinaryTargets: string | null = null

  const result = source
    // Clean up the datasource block
    .replace(
      /(datasource\s+\w+\s*\{)([^}]*?)(\})/g,
      (_fullMatch, open, body: string, close) => {
        // Capture directUrl env var name before removing
        const directUrlMatch = body.match(
          /directUrl\s*=\s*env\(["']([^"']+)["']\)/,
        )

        if (directUrlMatch) {
          directUrlEnvVar = directUrlMatch[1]
        }

        const cleaned = body
          // Remove url = env("...") or url = '...' lines
          .replace(/^[ \t]*url\s*=\s*.+\n?/gm, '')
          // Remove directUrl = env("...") or directUrl = '...' lines
          .replace(/^[ \t]*directUrl\s*=\s*.+\n?/gm, '')
          // Collapse more than two consecutive blank lines down to one
          .replace(/\n{3,}/g, '\n\n')

        return `${open}${cleaned}${close}`
      },
    )
    // Replace the generator client block
    .replace(
      /generator\s+client\s*\{([^}]*)\}/g,
      (_fullMatch, body: string) => {
        // Check for non-native binaryTargets
        const binaryMatch = body.match(
          /binaryTargets\s*=\s*(\[[^\]]*\]|"[^"]*"|'[^']*')/,
        )
        if (binaryMatch) {
          const val = binaryMatch[1]
          // Only warn if it's more than just "native"
          if (!/^\s*["']native["']\s*$/.test(val)) {
            customBinaryTargets = val
          }
        }

        return NEW_GENERATOR_BLOCK
      },
    )

  return { result, directUrlEnvVar, customBinaryTargets }
}

export async function updateSchemaFile(
  schemaPath: string,
): Promise<UpdateSchemaFileResult> {
  if (!fs.existsSync(schemaPath)) {
    return { status: 'skipped', warnings: [] }
  }

  const source = fs.readFileSync(schemaPath, 'utf-8')
  const warnings: string[] = []

  if (isAlreadyMigrated(source)) {
    return { status: 'unmodified', warnings }
  }

  const { result, directUrlEnvVar, customBinaryTargets } =
    transformSchema(source)

  if (directUrlEnvVar) {
    warnings.push(
      `A directUrl was found in your schema.prisma and has been removed. ` +
        `You should add it to api/prisma.config.cjs manually:\n` +
        `  datasource: {\n` +
        `    url: env('${directUrlEnvVar}'),\n` +
        `  },`,
    )
  }

  if (customBinaryTargets) {
    warnings.push(
      `binaryTargets (${customBinaryTargets}) has been removed from your ` +
        'schema.prisma. binaryTargets is no longer needed in Prisma v7 as ' +
        'the new driver is written in TypeScript.',
    )
  }

  if (result === source) {
    return { status: 'unmodified', warnings }
  }

  fs.writeFileSync(schemaPath, result, 'utf-8')
  return { status: 'updated', warnings }
}

export default async function runUpdateSchemaFile(): Promise<{
  results: {
    path: string
    status: UpdateSchemaFileResult['status']
    warnings: string[]
  }[]
}> {
  const paths = getPaths()
  const schemaPath = await getSchemaPath(paths.api.prismaConfig)

  const results: {
    path: string
    status: UpdateSchemaFileResult['status']
    warnings: string[]
  }[] = []

  if (schemaPath) {
    // Also check for sibling .prisma files in the same directory (multi-schema
    // setups), and transform them all.
    const schemaDir = path.dirname(schemaPath)
    const siblings = fs.existsSync(schemaDir)
      ? fs
          .readdirSync(schemaDir)
          .filter((f) => f.endsWith('.prisma'))
          .map((f) => path.join(schemaDir, f))
      : []

    // Ensure the primary schema is first and not duplicated
    const filesToProcess = [
      schemaPath,
      ...siblings.filter((f) => f !== schemaPath),
    ]

    for (const filePath of filesToProcess) {
      const result = await updateSchemaFile(filePath)
      results.push({ path: filePath, ...result })
    }
  }

  return { results }
}
