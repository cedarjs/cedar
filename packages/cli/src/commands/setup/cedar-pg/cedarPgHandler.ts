import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { Listr } from 'listr2'

import { colors, getPaths } from '@cedarjs/cli-helpers'
import {
  addWorkspacePackages,
  removeWorkspacePackages,
} from '@cedarjs/cli-helpers/packageManager/packages'
import { errorTelemetry } from '@cedarjs/telemetry'

import type { Args } from './cedarPg.js'

const cedarPaths = getPaths()

function resolveCedarPgSpec(explicitPath?: string): string {
  // Yarn 4 requires package-name@range (e.g. @cedarjs/pg@file:/abs/path)
  if (explicitPath) {
    return `@cedarjs/pg@file:${path.resolve(explicitPath)}`
  }
  if (process.env.CEDAR_PG_PATH) {
    return `@cedarjs/pg@file:${path.resolve(process.env.CEDAR_PG_PATH)}`
  }
  // Published alpha on npm (`alpha` dist-tag)
  return '@cedarjs/pg@alpha'
}

export async function handler({ force, path: cedarPgPath }: Args) {
  const schemaPath = path.join(cedarPaths.api.base, 'db', 'schema.prisma')
  const dbTsPath = path.join(cedarPaths.api.src, 'lib', 'db.ts')
  const envDefaultsPath = path.join(cedarPaths.base, '.env.defaults')
  const envPath = path.join(cedarPaths.base, '.env')
  const dbTsTemplatePath = path.join(
    import.meta.dirname,
    'templates',
    'db.ts.template',
  )
  const prismaConfigPath = path.join(cedarPaths.api.base, 'prisma.config.cjs')

  const notes: string[] = []
  const cedarPgSpec = resolveCedarPgSpec(cedarPgPath)

  const tasks = new Listr(
    [
      {
        title: 'Updating Prisma schema to PostgreSQL',
        task: () => {
          if (!fs.existsSync(schemaPath)) {
            throw new Error(`Missing schema at ${schemaPath}`)
          }
          let schema = fs.readFileSync(schemaPath, 'utf-8')
          if (schema.includes('provider = "postgresql"') && !force) {
            notes.push(colors.note('schema.prisma already uses postgresql'))
            return
          }
          schema = schema.replace(
            /provider\s*=\s*"(sqlite|postgresql|mysql|sqlserver|mongodb)"/,
            'provider = "postgresql"',
          )
          fs.writeFileSync(schemaPath, schema)
        },
      },
      {
        title: 'Writing api/src/lib/db.ts for PrismaPg',
        skip: () => {
          if (!force && fs.existsSync(dbTsPath)) {
            const existing = fs.readFileSync(dbTsPath, 'utf-8')
            if (existing.includes('PrismaPg')) {
              return 'db.ts already uses PrismaPg'
            }
          }
          return false
        },
        task: () => {
          const template = fs.readFileSync(dbTsTemplatePath, 'utf-8')
          fs.writeFileSync(dbTsPath, template)
        },
      },
      {
        title: 'Ensuring prisma.config uses DATABASE_URL',
        task: () => {
          if (!fs.existsSync(prismaConfigPath)) {
            fs.writeFileSync(
              prismaConfigPath,
              [
                "const { defineConfig, env } = require('prisma/config')",
                '',
                'module.exports = defineConfig({',
                "  schema: 'db/schema.prisma',",
                '  migrations: {',
                "    path: 'db/migrations',",
                "    seed: 'yarn cedar exec seed',",
                '  },',
                '  datasource: {',
                "    url: env('DATABASE_URL'),",
                '  },',
                '})',
                '',
              ].join('\n'),
            )
            return
          }
          let cfg = fs.readFileSync(prismaConfigPath, 'utf-8')
          if (cfg.includes("env('DIRECT_DATABASE_URL')")) {
            cfg = cfg.replace(
              "env('DIRECT_DATABASE_URL')",
              "env('DATABASE_URL')",
            )
            fs.writeFileSync(prismaConfigPath, cfg)
          }
        },
      },
      {
        title: 'Ignoring .cedar-pg/ in .gitignore',
        task: () => {
          const gitignorePath = path.join(cedarPaths.base, '.gitignore')
          const entry = '.cedar-pg/*'
          if (!fs.existsSync(gitignorePath)) {
            fs.writeFileSync(gitignorePath, `${entry}\n`)
            return
          }
          const content = fs.readFileSync(gitignorePath, 'utf-8')
          if (content.includes('.cedar-pg')) {
            return
          }
          const needle = '.cedar/*'
          if (content.includes(needle)) {
            fs.writeFileSync(
              gitignorePath,
              content.replace(needle, `${needle}\n${entry}`),
            )
            return
          }
          const suffix = content.endsWith('\n') ? entry + '\n' : `\n${entry}\n`
          fs.writeFileSync(gitignorePath, content + suffix)
        },
      },
      {
        title: 'Adding CEDAR_PG=1 to .env.defaults',
        task: () => {
          const target = fs.existsSync(envDefaultsPath)
            ? envDefaultsPath
            : envPath
          const original = fs.existsSync(target)
            ? fs.readFileSync(target, 'utf-8')
            : ''
          let content = original
          // Comment out sqlite DATABASE_URL so cedar-pg ensure can set Postgres
          content = content.replace(
            /^DATABASE_URL=file:.*$/m,
            '# DATABASE_URL provided by cedar-pg ensure when CEDAR_PG=1\n#$&',
          )
          if (!/^CEDAR_PG=/m.test(content)) {
            content +=
              (content.endsWith('\n') || content.length === 0 ? '' : '\n') +
              '# Worktree-isolated Postgres via cedar-pg + autopg\n' +
              'CEDAR_PG=1\n'
          }
          if (content !== original) {
            fs.writeFileSync(target, content)
          }
        },
      },
      {
        title: `Installing ${cedarPgSpec}, pg, @prisma/adapter-pg`,
        task: async () => {
          // Drop sqlite adapters if present (ignore failures when already gone)
          try {
            await removeWorkspacePackages(
              'api',
              ['better-sqlite3', '@prisma/adapter-better-sqlite3'],
              { cwd: cedarPaths.base },
            )
          } catch {
            // not installed
          }

          await addWorkspacePackages(
            'api',
            [cedarPgSpec, 'pg', '@prisma/adapter-pg@7.8.0'],
            { cwd: cedarPaths.base },
          )
        },
      },
      {
        title: 'Checking autopg host binary',
        task: (_ctx, task) => {
          const which = spawnSync('which', ['autopg'], { encoding: 'utf8' })
          if (which.status === 0) {
            task.title = `Checking autopg host binary (${which.stdout.trim()})`
            return
          }
          notes.push(
            colors.warning(
              'autopg not found on PATH. Install with:\n' +
                '  curl -fsSL https://raw.githubusercontent.com/automagik-dev/autopg/main/install.sh | bash\n' +
                'Or set AUTOPG_BIN. @cedarjs/pg postinstall may also install it.',
            ),
          )
        },
      },
    ],
    { rendererOptions: { collapseSubtasks: false } },
  )

  try {
    await tasks.run()
    console.log()
    console.log(colors.success('cedar-pg setup complete.'))
    console.log(
      colors.info(
        'Dev/test will call cedar-pg ensure when CEDAR_PG=1. ' +
          'See https://cedarjs.com/docs/local-postgres-setup',
      ),
    )
    for (const note of notes) {
      console.log(note)
    }
  } catch (e) {
    errorTelemetry(process.argv, (e as Error).message)
    console.error(colors.error((e as Error).message))
    process.exit(1)
  }
}
