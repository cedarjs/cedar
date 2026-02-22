import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import execa from 'execa'
import { Listr } from 'listr2'
import { terminalLink } from 'termi-link'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { buildApi, cleanApiBuild } from '@cedarjs/internal/dist/build/api'
import { generate } from '@cedarjs/internal/dist/generate/generate'
import { loadAndValidateSdls } from '@cedarjs/internal/dist/validateSchema'
import { detectPrerenderRoutes } from '@cedarjs/prerender/detection'
import { timedTelemetry } from '@cedarjs/telemetry'

import c from '../../lib/colors.js'
import { generatePrismaCommand } from '../../lib/generatePrismaClient.js'
import { getPaths, getConfig } from '../../lib/index.js'

import { buildPackagesTask } from './buildPackagesTask.js'

/**
 * Checks that every workspace package under `packages/` has the entry files
 * declared in its package.json (`main`, `exports`). If any are missing, prints
 * a clear error message so users know which package needs to be built.
 *
 * Returns an array of human-readable problem descriptions (empty = all good).
 */
function checkWorkspacePackageEntryPoints(cedarPaths) {
  const packagesDir = cedarPaths.packages

  if (!packagesDir || !fs.existsSync(packagesDir)) {
    return []
  }

  const problems = []
  const packageDirs = fs.readdirSync(packagesDir, { withFileTypes: true })

  for (const entry of packageDirs) {
    if (!entry.isDirectory()) {
      continue
    }

    const pkgJsonPath = path.join(packagesDir, entry.name, 'package.json')

    if (!fs.existsSync(pkgJsonPath)) {
      continue
    }

    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
    const pkgName = pkgJson.name || entry.name
    const pkgDir = path.join(packagesDir, entry.name)

    // Collect declared entry files from "main" and "exports"
    const entryFiles = new Set()

    if (pkgJson.main) {
      entryFiles.add(path.normalize(pkgJson.main))
    }

    if (pkgJson.exports) {
      const collectPaths = (obj) => {
        if (typeof obj === 'string') {
          // Only check non-type entry points (JS files)
          if (!obj.endsWith('.d.ts')) {
            entryFiles.add(path.normalize(obj))
          }
        } else if (obj && typeof obj === 'object') {
          for (const [key, value] of Object.entries(obj)) {
            if (key !== 'types') {
              collectPaths(value)
            }
          }
        }
      }

      collectPaths(pkgJson.exports)
    }

    for (const entryFile of entryFiles) {
      const resolvedPath = path.resolve(pkgDir, entryFile)

      if (!fs.existsSync(resolvedPath)) {
        problems.push({ pkgName, entryFile, pkgDir })
      }
    }
  }

  return problems
}

export const handler = async ({
  workspace = ['api', 'web', 'packages/*'],
  verbose = false,
  prisma = true,
  prerender = true,
}) => {
  recordTelemetryAttributes({
    command: 'build',
    workspace: JSON.stringify(workspace),
    verbose,
    prisma,
    prerender,
  })

  const cedarPaths = getPaths()
  const cedarConfig = getConfig()
  const useFragments = cedarConfig.graphql?.fragments
  const useTrustedDocuments = cedarConfig.graphql?.trustedDocuments

  const prismaSchemaExists = fs.existsSync(cedarPaths.api.prismaConfig)
  const prerenderRoutes =
    prerender && workspace.includes('web') ? detectPrerenderRoutes() : []
  const shouldGeneratePrismaClient =
    prisma &&
    prismaSchemaExists &&
    (workspace.includes('api') || prerenderRoutes.length > 0)

  const packageJsonPath = path.join(cedarPaths.base, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const packageJsonWorkspaces = packageJson.workspaces
  const nonApiWebWorkspaces =
    Array.isArray(packageJsonWorkspaces) && packageJsonWorkspaces.length > 2
      ? workspace.filter((w) => w !== 'api' && w !== 'web')
      : []

  const gqlFeaturesTaskTitle = `Generating types needed for ${[
    useFragments && 'GraphQL Fragments',
    useTrustedDocuments && 'Trusted Documents',
  ]
    .filter(Boolean)
    .join(' and ')} support...`

  const tasks = [
    shouldGeneratePrismaClient && {
      title: 'Generating Prisma Client...',
      task: async () => {
        const { cmd, args } = await generatePrismaCommand()

        return execa(cmd, args, {
          stdio: verbose ? 'inherit' : 'pipe',
          cwd: cedarPaths.api.base,
        })
      },
    },
    nonApiWebWorkspaces.length > 0 && {
      title: 'Building Packages...',
      task: (_ctx, task) => buildPackagesTask(task, nonApiWebWorkspaces),
    },
    (workspace.includes('web') || workspace.includes('api')) && {
      title: 'Checking workspace packages...',
      task: () => {
        const problems = checkWorkspacePackageEntryPoints(cedarPaths)

        if (problems.length === 0) {
          return
        }

        const details = problems
          .map(
            ({ pkgName, entryFile, pkgDir }) =>
              `  • ${c.error(pkgName)}: missing "${entryFile}" (in ${pkgDir})`,
          )
          .join('\n')

        throw new Error(
          `The following workspace package entry points are missing:\n${details}\n\n` +
            'This usually means the package has not been built yet.\n' +
            'Run ' +
            c.info('yarn cedar build') +
            ' (without specifying a workspace) to build everything,\n' +
            'or build the package manually first, e.g. ' +
            c.info(`yarn workspace ${problems[0].pkgName} build`),
        )
      },
    },
    // If using GraphQL Fragments or Trusted Documents, then we need to use
    // codegen to generate the types needed for possible types and the trusted
    // document store hashes
    (useFragments || useTrustedDocuments) && {
      title: gqlFeaturesTaskTitle,
      task: generate,
    },
    workspace.includes('api') && {
      title: 'Verifying graphql schema...',
      task: loadAndValidateSdls,
    },
    workspace.includes('api') && {
      title: 'Building API...',
      task: async () => {
        await cleanApiBuild()
        const { errors, warnings } = await buildApi()

        if (errors.length) {
          console.error(errors)
        }
        if (warnings.length) {
          console.warn(warnings)
        }
      },
    },
    workspace.includes('web') && {
      title: 'Building Web...',
      task: async () => {
        // Disable the new warning in Vite v5 about the CJS build being deprecated
        // so that users don't have to see it when this command is called with --verbose
        process.env.VITE_CJS_IGNORE_WARNING = 'true'

        const createdRequire = createRequire(import.meta.url)
        const buildBinPath = createdRequire.resolve(
          '@cedarjs/vite/bins/rw-vite-build.mjs',
        )

        // @NOTE: we're using the vite build command here, instead of the
        // buildWeb function directly because we want the process.cwd to be
        // the web directory, not the root of the project.
        // This is important for postcss/tailwind to work correctly
        // Having a separate binary lets us contain the change of cwd to that
        // process only. If we changed cwd here, or in the buildWeb function,
        // it could affect other things that run in parallel while building.
        // We don't have any parallel tasks right now, but someone might add
        // one in the future as a performance optimization.
        await execa(
          `node ${buildBinPath} --webDir="${cedarPaths.web.base}" --verbose=${verbose}`,
          {
            stdio: verbose ? 'inherit' : 'pipe',
            shell: true,
            // `cwd` is needed for yarn to find the rw-vite-build binary
            // It won't change process.cwd for anything else here, in this
            // process
            cwd: cedarPaths.web.base,
          },
        )

        // Streaming SSR does not use the index.html file.
        if (!getConfig().experimental?.streamingSsr?.enabled) {
          console.log('Creating 200.html...')

          const indexHtmlPath = path.join(getPaths().web.dist, 'index.html')

          fs.copyFileSync(
            indexHtmlPath,
            path.join(getPaths().web.dist, '200.html'),
          )
        }
      },
    },
  ].filter(Boolean)

  const triggerPrerender = async () => {
    console.log('Starting prerendering...')
    if (prerenderRoutes.length === 0) {
      console.log(
        `You have not marked any routes to "prerender" in your ${terminalLink(
          'Routes',
          'file://' + cedarPaths.web.routes,
        )}.`,
      )

      return
    }

    // Running a separate process here, otherwise it wouldn't pick up the
    // generated Prisma Client due to require module caching
    await execa('yarn cedar prerender', {
      stdio: 'inherit',
      shell: true,
      cwd: cedarPaths.web.base,
    })
  }

  const jobs = new Listr(tasks, {
    renderer: verbose ? 'verbose' : undefined,
  })

  await timedTelemetry(process.argv, { type: 'build' }, async () => {
    await jobs.run()

    if (workspace.includes('web') && prerender && prismaSchemaExists) {
      // This step is outside Listr so that it prints clearer, complete messages
      await triggerPrerender()
    }
  })
}
