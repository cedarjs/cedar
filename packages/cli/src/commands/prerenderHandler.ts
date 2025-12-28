import fs from 'node:fs'
import path from 'path'

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

const mapRouterPathToHtml = (routerPath: string) => {
  if (routerPath === '/') {
    return 'web/dist/index.html'
  } else {
    return `web/dist${routerPath}.html`
  }
}

function getRouteHooksFilePath(routeFilePath: string) {
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

interface Route {
  name: string
  path: string
  routePath: string
  hasParams: boolean
  id: string
  isNotFound: boolean
  filePath: string
}

/**
 * Takes a route with a path like /blog-post/{id:Int}
 * Reads path parameters from BlogPostPage.routeHooks.js and returns a list of
 * routes with the path parameter placeholders (like {id:Int}) replaced by
 * actual values
 */
async function expandRouteParameters(route: Route): Promise<Route[]> {
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

    if (routeParameters) {
      return (routeParameters as Record<string, unknown>[]).map(
        (pathParamValues) => {
          let newPath = route.path

          Object.entries(pathParamValues).forEach(
            ([_paramName, paramValue]) => {
              newPath = newPath.replace(
                new RegExp(`{\${_paramName}:?[^}]*}`),
                String(paramValue),
              )
            },
          )

          return { ...route, path: newPath }
        },
      )
    }
  } catch (e: unknown) {
    const stack = e instanceof Error ? e.stack : String(e)
    console.error(c.error(stack))
    return [route]
  }

  return [route]
}

// This is used directly in build.js for nested ListrTasks
export const getTasks = async (
  dryrun: boolean,
  routerPathFilter: string | null = null,
) => {
  const detector = (
    projectIsEsm()
      ? await import('@cedarjs/prerender/detection')
      : await import('@cedarjs/prerender/cjs/detection')
  ) as Record<string, unknown>

  const prerenderRoutes = (
    detector as any
  ) /* @cedarjs/prerender is not perfectly typed here */
    .detectPrerenderRoutes()
    .filter((route: Route) => route.path) as Route[]

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
  }

  configureBabel()

  const expandedRouteParameters = await Promise.all(
    prerenderRoutes.map((route) => expandRouteParameters(route)),
  )

  const prerenderer = projectIsEsm()
    ? await import('@cedarjs/prerender')
    : await import('@cedarjs/prerender/cjs')

  const listrTasks = expandedRouteParameters.flatMap((routesToPrerender) => {
    // queryCache will be filled with the queries from all the Cells we
    // encounter while prerendering, and the result from executing those
    // queries.
    const queryCache = {}

    // In principle you could be prerendering a large number of routes
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
          task: async (
            _: unknown,
            task: any /* ListrTaskWrapper is hard to type here */,
          ) => {
            for (let i = 0; i < routesToPrerender.length; i++) {
              const routeToPrerender = routesToPrerender[i]

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

    return routesToPrerender
      .map((routeToPrerender) => {
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
      .flat()
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

    process.exit(1)
  } else {
    console.log('✔ Diagnostics checks passed \n')
  }
}

const prerenderRoute = async (
  prerenderer: any /* @cedarjs/prerender is not perfectly typed here */,
  queryCache: Record<string, unknown>,
  routeToPrerender: Route,
  dryrun: boolean,
  outputHtmlPath: string,
) => {
  if (/\\{.*}/.test(routeToPrerender.path)) {
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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error ? e.stack : String(e)
    console.log()
    console.log(
      c.warning('You can use `yarn cedar prerender --dry-run` to debug'),
    )
    console.log()

    console.log(
      `${c.info('-'.repeat(10))} Error rendering path "${routeToPrerender.path}" ${c.info('-'.repeat(10))}`,
    )

    errorTelemetry(process.argv, `Error prerendering: ${message}`)

    console.error(c.error(stack))
    console.log()

    throw new Error(`Failed to render "${routeToPrerender.filePath}"`)
  }
}

interface HandlerOptions {
  path?: string
  dryRun?: boolean
  verbose?: boolean
}

export const handler = async ({
  path: routerPath,
  dryRun = false,
  verbose = false,
}: HandlerOptions) => {
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

  try {
    if (dryRun) {
      console.log(c.info('::: Dry run, not writing changes :::'))
    }

    await new Listr(listrTasks, {
      renderer: verbose ? 'verbose' : 'default',
      rendererOptions: { collapseSubtasks: false },
      concurrent: false,
    }).run()
  } catch (e) {
    console.log()
    diagnosticCheck()

    console.log(c.warning('Tips:'))

    if (e instanceof PathParamError) {
      console.log(
        c.info(
          "- You most likely need to add or update a *.routeHooks.{js,ts} file next to the Page you're trying to prerender",
        ),
      )
    } else {
      console.log(
        c.info(
          "- This could mean that a library you're using does not support SSR.",
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
