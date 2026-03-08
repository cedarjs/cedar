import fs from 'node:fs'
import path from 'node:path'

import { Listr } from 'listr2'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { getConfig, getPaths, projectIsEsm } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

// @ts-expect-error - Types not available for JS files
import c from '../lib/colors.js'
// @ts-expect-error - Types not available for JS files
import { runScriptFunction } from '../lib/exec.js'
// @ts-expect-error - Types not available for JS files
import { configureBabel } from '../lib/execBabel.js'

class PathParamError extends Error {}

type RouteParamValue = string | number | boolean
type RouteParamValues = Record<string, RouteParamValue>

type PrerenderRoute = {
  name: string
  path: string
  routePath: string
  filePath: string
  [key: string]: unknown
}

type MaybePrerenderRoute = Partial<PrerenderRoute> & {
  [key: string]: unknown
}

type PrerendererModule = {
  runPrerender: (args: {
    queryCache: Record<string, unknown>
    renderPath: string
  }) => Promise<string>
  writePrerenderedHtmlFile: (outputHtmlPath: string, html: string) => void
}

const hasPath = (
  route: MaybePrerenderRoute,
): route is MaybePrerenderRoute & { path: string } => {
  return typeof route.path === 'string' && route.path.length > 0
}

const normalizeRoute = (
  route: MaybePrerenderRoute & { path: string },
): PrerenderRoute => {
  const normalizedPath = route.path
  const normalizedName =
    typeof route.name === 'string' ? route.name : normalizedPath
  const normalizedRoutePath =
    typeof route.routePath === 'string' ? route.routePath : normalizedPath
  const normalizedFilePath =
    typeof route.filePath === 'string' ? route.filePath : ''

  return {
    ...route,
    name: normalizedName,
    path: normalizedPath,
    routePath: normalizedRoutePath,
    filePath: normalizedFilePath,
  }
}

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error)
}

const getErrorStack = (error: unknown): string => {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}

const mapRouterPathToHtml = (routerPath: string) => {
  if (routerPath === '/') {
    return 'web/dist/index.html'
  }

  return `web/dist${routerPath}.html`
}

function getRouteHooksFilePath(routeFilePath: string): string | undefined {
  const routeHooksFilePathTs = routeFilePath.replace(
    /\.[jt]sx?$/,
    '.routeHooks.ts',
  )

  if (fs.existsSync(routeHooksFilePathTs)) {
    return routeHooksFilePathTs
  }

  const routeHooksFilePathJs = routeFilePath.replace(
    /\.[jt]sx?$/,
    '.routeHooks.js',
  )

  if (fs.existsSync(routeHooksFilePathJs)) {
    return routeHooksFilePathJs
  }

  return undefined
}

async function expandRouteParameters(route: PrerenderRoute) {
  const routeHooksFilePath = getRouteHooksFilePath(route.filePath)

  if (!routeHooksFilePath) {
    return [route]
  }

  try {
    const routeParameters = await runScriptFunction({
      path: routeHooksFilePath,
      functionName: 'routeParameters',
      args: {
        name: route.name,
        path: route.path,
        routePath: route.routePath,
        filePath: route.filePath,
      },
    })

    if (Array.isArray(routeParameters)) {
      return routeParameters.map((pathParamValues) => {
        let newPath = route.path

        if (
          typeof pathParamValues === 'object' &&
          pathParamValues !== null &&
          !Array.isArray(pathParamValues)
        ) {
          Object.entries(pathParamValues as RouteParamValues).forEach(
            ([paramName, paramValue]) => {
              newPath = newPath.replace(
                new RegExp(`{${paramName}:?[^}]*}`),
                String(paramValue),
              )
            },
          )
        }

        return { ...route, path: newPath }
      })
    }
  } catch (error: unknown) {
    console.error(c.error(getErrorStack(error)))
    return [route]
  }

  return [route]
}

// This is used directly in build.js for nested ListrTasks
export const getTasks = async (dryrun: boolean, routerPathFilter: string | null = null) => {
  const detector = projectIsEsm()
    ? await import('@cedarjs/prerender/detection')
    : await import('@cedarjs/prerender/cjs/detection')

  const detectedRoutes = detector.detectPrerenderRoutes() as MaybePrerenderRoute[]
  const prerenderRoutes = detectedRoutes.filter(hasPath).map(normalizeRoute)
  const indexHtmlPath = path.join(getPaths().web.dist, 'index.html')
  if (prerenderRoutes.length === 0) {
    console.log('\nSkipping prerender...')
    console.log(
      c.warning(
        'You have not marked any routes with a path as `prerender` in `Routes.{jsx,tsx}` \n',
      ),
    )

    // Don't error out
    return []
  }

  if (!fs.existsSync(indexHtmlPath)) {
    console.error(
      'You must run `yarn cedar build web` before trying to prerender.',
    )
    process.exit(1)
    // TODO: Run this automatically at this point.
  }

  configureBabel()

  const expandedRouteParameters = await Promise.all(
    prerenderRoutes.map((route) => expandRouteParameters(route)),
  )

  const prerenderer = (projectIsEsm()
    ? await import('@cedarjs/prerender')
    : await import('@cedarjs/prerender/cjs')) as PrerendererModule

  const listrTasks = expandedRouteParameters.flatMap((routesToPrerender) => {
    const queryCache: Record<string, unknown> = {}
    const shouldFold = routesToPrerender.length > 16

    if (shouldFold) {
      const displayIncrement = Math.max(
        1,
        Math.floor(routesToPrerender.length / 100),
      )
      const title = (i: number) =>
        `Prerendering ${routesToPrerender[0].name} (${i.toLocaleString()} of ${routesToPrerender.length.toLocaleString()})`

      return [
        {
          title: title(0),
          task: async (_ctx: unknown, task: { title: string }) => {
            // Note: This is a sequential loop, not parallelized as there have been previous issues
            // with parallel prerendering. See:https://github.com/redwoodjs/redwood/pull/7321
            for (let i = 0; i < routesToPrerender.length; i++) {
              const routeToPrerender = routesToPrerender[i]

              // Filter out routes that don't match the supplied routePathFilter
              if (
                routerPathFilter &&
                routeToPrerender.path !== routerPathFilter
              ) {
                continue
              }

              await prerenderRoute(
                prerenderer,
                queryCache,
                routeToPrerender,
                dryrun,
                mapRouterPathToHtml(routeToPrerender.path),
              )

              if (i % displayIncrement === 0) {
                task.title = title(i)
              }
            }

            task.title = title(routesToPrerender.length)
          },
        },
      ]
    }

    // If we're not folding the output, we'll return a list of tasks for each
    // individual case.
    return routesToPrerender.flatMap((routeToPrerender) => {
      // Filter out routes that don't match the supplied routePathFilter
      if (routerPathFilter && routeToPrerender.path !== routerPathFilter) {
        return []
      }

      const outputHtmlPath = mapRouterPathToHtml(routeToPrerender.path)
      return {
        title: `Prerendering ${routeToPrerender.path} -> ${outputHtmlPath}`,
        task: async () => {
          await prerenderRoute(
            prerenderer,
            queryCache,
            routeToPrerender,
            dryrun,
            outputHtmlPath,
          )
        },
      }
    })
  })

  return listrTasks
}

const diagnosticCheck = () => {
  const checks = [
    {
      message: 'Duplicate React version found in web/node_modules',
      failure: fs.existsSync(
        path.join(getPaths().web.base, 'node_modules/react'),
      ),
    },
    {
      message: 'Duplicate react-dom version found in web/node_modules',
      failure: fs.existsSync(
        path.join(getPaths().web.base, 'node_modules/react-dom'),
      ),
    },
    {
      message: 'Duplicate core-js version found in web/node_modules',
      failure: fs.existsSync(
        path.join(getPaths().web.base, 'node_modules/core-js'),
      ),
    },
    {
      message: 'Duplicate @cedarjs/web version found in web/node_modules',
      failure: fs.existsSync(
        path.join(getPaths().web.base, 'node_modules/@cedarjs/web'),
      ),
    },
  ]
  console.log('Running diagnostic checks')

  if (checks.some((check) => check.failure)) {
    console.error(c.error('node_modules are being duplicated in `./web` \n'))
    console.log('⚠️  Issues found: ')
    console.log('-'.repeat(50))

    checks
      .filter((check) => check.failure)
      .forEach((check, i) => {
        console.log(`${i + 1}. ${check.message}`)
      })

    console.log('-'.repeat(50))

    console.log(
      'Diagnostic check found issues. See the Redwood Forum link below for help:',
    )

    console.log(
      c.underline(
        'https://community.redwoodjs.com/search?q=duplicate%20package%20found',
      ),
    )

    console.log()

    // Exit, no need to show other messages
    process.exit(1)
  } else {
    console.log('✔ Diagnostics checks passed \n')
  }
}

const prerenderRoute = async (
  prerenderer: PrerendererModule,
  queryCache: Record<string, unknown>,
  routeToPrerender: PrerenderRoute,
  dryrun: boolean,
  outputHtmlPath: string,
) => {
  // Check if route param templates in e.g. /path/{param1} have been replaced
  if (/\{.*}/.test(routeToPrerender.path)) {
    throw new PathParamError(
      `Could not retrieve route parameters for ${routeToPrerender.path}`,
    )
  }

  try {
    const prerenderedHtml = await prerenderer.runPrerender({
      queryCache,
      renderPath: routeToPrerender.path,
    })

    if (!dryrun) {
      prerenderer.writePrerenderedHtmlFile(outputHtmlPath, prerenderedHtml)
    }
  } catch (error: unknown) {
    console.log()
    console.log(
      c.warning('You can use `yarn cedar prerender --dry-run` to debug'),
    )
    console.log()

    console.log(
      `${c.info('-'.repeat(10))} Error rendering path "${
        routeToPrerender.path
      }" ${c.info('-'.repeat(10))}`,
    )

    errorTelemetry(process.argv, `Error prerendering: ${getErrorMessage(error)}`)

    console.error(c.error(getErrorStack(error)))
    console.log()

    throw new Error(`Failed to render "${routeToPrerender.filePath}"`)
  }
}

type PrerenderHandlerArgs = {
  path?: string
  dryRun?: boolean
  verbose?: boolean
}

export const handler = async ({
  path: routerPath,
  dryRun = false,
  verbose = false,
}: PrerenderHandlerArgs) => {
  if (getConfig().experimental?.streamingSsr?.enabled) {
    console.log(
      c.warning(
        'Prerendering is not yet supported with Streaming SSR. Skipping prerender...',
      ),
    )

    return
  }

  recordTelemetryAttributes({
    command: 'prerender',
    dryRun,
    verbose,
  })

  const listrTasks = await getTasks(dryRun, routerPath ?? null)

  const tasks = new Listr(listrTasks, {
    renderer: verbose ? 'verbose' : 'default',
    concurrent: false,
  })

  try {
    if (dryRun) {
      console.log(c.info('::: Dry run, not writing changes :::'))
    }

    await tasks.run()
  } catch (error: unknown) {
    console.log()
    diagnosticCheck()

    console.log(c.warning('Tips:'))

    if (error instanceof PathParamError) {
      console.log(
        c.info(
          "- You most likely need to add or update a *.routeHooks.{js,ts} file next to the Page you're trying to prerender",
        ),
      )
    } else {
      console.log(
        c.info(
          `- This could mean that a library you're using does not support SSR.`,
        ),
      )
      console.log(
        c.info(
          '- Avoid using `window` in the initial render path through your React components without checks. \n  See https://cedarjs.com/docs/prerender#prerender-utils',
        ),
      )

      console.log(
        c.info(
          '- Avoid prerendering Cells with authenticated queries, by conditionally rendering them.\n  See https://cedarjs.com/docs/prerender#common-warnings--errors',
        ),
      )
    }

    console.log()

    process.exit(1)
  }
}
