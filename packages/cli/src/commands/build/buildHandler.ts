import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import execa from 'execa'
import { Listr } from 'listr2'
import type { ListrTask } from 'listr2'
import { terminalLink } from 'termi-link'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import {
  formatCedarCommand,
  formatRunWorkspaceScriptCommand,
} from '@cedarjs/cli-helpers/packageManager/display'
import { runBin } from '@cedarjs/cli-helpers/packageManager/exec'
import {
  buildApi,
  buildApiWithVite,
  cleanApiBuild,
} from '@cedarjs/internal/dist/build/api'
import { generate } from '@cedarjs/internal/dist/generate/generate'
import { generateGqlormArtifacts } from '@cedarjs/internal/dist/generate/gqlormSchema'
import { loadAndValidateSdls } from '@cedarjs/internal/dist/validateSchema'
import { detectPrerenderRoutes } from '@cedarjs/prerender/detection'
import { type Paths } from '@cedarjs/project-config'
import { timedTelemetry } from '@cedarjs/telemetry'
import { buildCedarApp } from '@cedarjs/vite/build'
import { buildUDApiServer } from '@cedarjs/vite/buildUDApiServer'

import { generatePrismaCommand } from '../../lib/generatePrismaClient.js'
// @ts-expect-error - Types not available for JS files
import { getPaths, getConfig } from '../../lib/index.js'

// @ts-expect-error - Types not available for JS files
import { buildPackagesTask } from './buildPackagesTask.js'

interface PackageJson {
  name?: string
  main?: string
  exports?: unknown
  workspaces?: unknown
}

/**
 * Checks that every workspace package under `packages/` has the entry files
 * declared in its package.json (`main`, `exports`). If any are missing, prints
 * a clear error message so users know which package needs to be built.
 *
 * Returns an array of human-readable problem descriptions (empty = all good).
 */
function checkWorkspacePackageEntryPoints(
  cedarPaths: Paths,
): { pkgName: string; entryFile: string; pkgDir: string }[] {
  const packagesDir = cedarPaths.packages

  if (!packagesDir || !fs.existsSync(packagesDir)) {
    return []
  }

  const problems: { pkgName: string; entryFile: string; pkgDir: string }[] = []
  const packageDirs = fs.readdirSync(packagesDir, { withFileTypes: true })

  for (const entry of packageDirs) {
    if (!entry.isDirectory()) {
      continue
    }

    const pkgJsonPath = path.join(packagesDir, entry.name, 'package.json')

    if (!fs.existsSync(pkgJsonPath)) {
      continue
    }

    const pkgJson: PackageJson = JSON.parse(
      fs.readFileSync(pkgJsonPath, 'utf8'),
    )
    const pkgName = pkgJson.name || entry.name
    const pkgDir = path.join(packagesDir, entry.name)

    // Collect declared entry files from "main" and "exports"
    const entryFiles = new Set<string>()

    if (pkgJson.main) {
      entryFiles.add(path.normalize(pkgJson.main))
    }

    if (pkgJson.exports) {
      const collectPaths = (obj: unknown) => {
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

export interface BuildHandlerOptions {
  workspace?: string[]
  verbose?: boolean
  prisma?: boolean
  prerender?: boolean
  ud?: boolean
}

export const handler = async ({
  workspace = ['api', 'web', 'packages/*'],
  verbose = false,
  prisma = true,
  prerender = true,
  ud = false,
}: BuildHandlerOptions) => {
  recordTelemetryAttributes({
    command: 'build',
    workspace: JSON.stringify(workspace),
    verbose,
    prisma,
    prerender,
  })

  const cedarPaths: Paths = getPaths()
  const cedarConfig = getConfig()
  const useFragments = cedarConfig.graphql?.fragments
  const useTrustedDocuments = cedarConfig.graphql?.trustedDocuments
  const usePackagesWorkspace =
    cedarConfig.experimental?.packagesWorkspace?.enabled

  const prismaSchemaExists = fs.existsSync(cedarPaths.api.prismaConfig)
  const prerenderRoutes =
    prerender && workspace.includes('web') ? detectPrerenderRoutes() : []
  const shouldGeneratePrismaClient =
    prisma &&
    prismaSchemaExists &&
    (workspace.includes('api') || prerenderRoutes.length > 0)

  const packageJsonPath = path.join(cedarPaths.base, 'package.json')
  const packageJson: { workspaces?: unknown } = JSON.parse(
    fs.readFileSync(packageJsonPath, 'utf8'),
  )
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
    nonApiWebWorkspaces.length > 0 &&
      usePackagesWorkspace && {
        title: 'Building Packages...',
        task: (_ctx: unknown, task: unknown) =>
          buildPackagesTask(task, nonApiWebWorkspaces),
      },
    (workspace.includes('web') || workspace.includes('api')) &&
      usePackagesWorkspace && {
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
              c.info(formatCedarCommand(['build'])) +
              ' (without specifying a workspace) to build everything,\n' +
              'or build the package manually first, e.g. ' +
              c.info(
                formatRunWorkspaceScriptCommand(problems[0].pkgName, 'build'),
              ),
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
    workspace.includes('web') &&
      cedarConfig.experimental?.gqlorm?.enabled && {
        title: 'Generating gqlorm schema...',
        task: async () => {
          const { errors } = await generateGqlormArtifacts()
          if (errors.length > 0) {
            for (const { message } of errors) {
              console.warn(`Warning: ${message}`)
            }
          }
        },
      },
    workspace.includes('api') && {
      title: 'Verifying graphql schema...',
      task: loadAndValidateSdls,
    },
    // When streaming SSR is enabled, fall back to the legacy separate build
    // paths because streaming SSR has its own complex build orchestration.
    // Phase 7 (SSR/RSC rebuild) will address unifying this path.
    workspace.includes('api') &&
      getConfig().experimental?.streamingSsr?.enabled && {
        title: 'Building API...',
        task: async () => {
          await cleanApiBuild()
          await buildApiWithVite()
        },
      },
    workspace.includes('web') &&
      getConfig().experimental?.streamingSsr?.enabled && {
        title: 'Building Web...',
        task: async () => {
          process.env.VITE_CJS_IGNORE_WARNING = 'true'

          const createdRequire = createRequire(import.meta.url)
          const buildBinPath = createdRequire.resolve(
            '@cedarjs/vite/bins/cedar-vite-build.mjs',
          )

          await execa(
            `node ${buildBinPath} --webDir="${cedarPaths.web.base}" --verbose=${verbose}`,
            {
              stdio: verbose ? 'inherit' : 'pipe',
              shell: true,
              cwd: cedarPaths.web.base,
            },
          )

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
    // Legacy separate build path (default when not --ud, non-streaming-SSR)
    workspace.includes('api') &&
      !ud &&
      !getConfig().experimental?.streamingSsr?.enabled && {
        title: 'Building API...',
        task: async () => {
          await cleanApiBuild()
          const { errors, warnings } = await buildApi()

          if (warnings.length) {
            console.warn(warnings)
          }

          if (errors.length) {
            throw new Error(
              `API build failed with ${errors.length} error(s). See output above for details.`,
            )
          }
        },
      },
    workspace.includes('web') &&
      !ud &&
      !getConfig().experimental?.streamingSsr?.enabled && {
        title: 'Building Web...',
        task: async () => {
          // Disable the new warning in Vite v5 about the CJS build being deprecated
          // so that users don't have to see it when this command is called with --verbose
          process.env.VITE_CJS_IGNORE_WARNING = 'true'

          const createdRequire = createRequire(import.meta.url)
          const buildBinPath = createdRequire.resolve(
            '@cedarjs/vite/bins/cedar-vite-build.mjs',
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
              // `cwd` is needed for yarn to find the cedar-vite-build binary
              // It won't change process.cwd for anything else here, in this
              // process
              cwd: cedarPaths.web.base,
            },
          )

          console.log('Creating 200.html...')

          const indexHtmlPath = path.join(getPaths().web.dist, 'index.html')

          fs.copyFileSync(
            indexHtmlPath,
            path.join(getPaths().web.dist, '200.html'),
          )
        },
      },
    // Unified build path (experimental, non-streaming-SSR, --ud)
    (workspace.includes('api') || workspace.includes('web')) &&
      ud &&
      !getConfig().experimental?.streamingSsr?.enabled && {
        title:
          workspace.includes('api') && workspace.includes('web')
            ? 'Building App...'
            : workspace.includes('api')
              ? 'Building API...'
              : 'Building Web...',
        task: async () => {
          // Disable the new warning in Vite v5 about the CJS build being deprecated
          // so that users don't have to see it when this command is called with --verbose
          process.env.VITE_CJS_IGNORE_WARNING = 'true'

          if (workspace.includes('api')) {
            await cleanApiBuild()
          }

          // PostCSS/Tailwind resolution depends on cwd being the web directory.
          // We temporarily switch cwd for the build and restore it afterwards.
          const originalCwd = process.cwd()
          process.chdir(cedarPaths.web.base)

          try {
            await buildCedarApp({ verbose, workspace })
          } finally {
            process.chdir(originalCwd)
          }

          // Streaming SSR does not use the index.html file.
          if (workspace.includes('web')) {
            console.log('Creating 200.html...')

            const indexHtmlPath = path.join(getPaths().web.dist, 'index.html')

            fs.copyFileSync(
              indexHtmlPath,
              path.join(getPaths().web.dist, '200.html'),
            )
          }
        },
      },
    ud &&
      workspace.includes('api') && {
        title: 'Bundling API server entry (Universal Deploy)...',
        task: async () => {
          await buildUDApiServer({ verbose })
        },
      },
  ].filter((t): t is ListrTask => Boolean(t))

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
    await runBin('cedar', ['prerender'], {
      stdio: 'inherit',
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
