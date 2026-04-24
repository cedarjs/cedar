import path from 'node:path'
import { pathToFileURL } from 'node:url'

// See https://github.com/webdiscus/ansis#troubleshooting
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import ansis from 'ansis'
import type { Handler } from 'aws-lambda'
import fg from 'fast-glob'
import type { Options as FastGlobOptions } from 'fast-glob'
import type {
  FastifyReply,
  FastifyRequest,
  RequestGenericInterface,
} from 'fastify'

import type {
  CedarHandler,
  CedarRouteRecord,
  LegacyHandler,
} from '@cedarjs/api/runtime'
import { buildCedarContext, wrapLegacyHandler } from '@cedarjs/api/runtime'
import { getPaths } from '@cedarjs/project-config'

import { requestHandler } from '../requestHandlers/awsLambdaFastify.js'
import { escape } from '../utils.js'

export const LAMBDA_FUNCTIONS = new Map<string, Handler>()
export const CEDAR_HANDLERS = new Map<string, CedarHandler>()
const cedarRouteManifest: CedarRouteRecord[] = []

/**
 * Exports a copy of the Cedar route manifest.
 *
 * This is intended to be used to later build WinterTC compatible `fetch`
 * exports
 */
export const getCedarRouteManifest = () => [...cedarRouteManifest]

// Import the API functions and add them to the LAMBDA_FUNCTIONS map

export const setLambdaFunctions = async (foundFunctions: string[]) => {
  const tsImport = Date.now()
  console.log(ansis.dim.italic('Importing Server Functions... '))

  cedarRouteManifest.length = 0
  CEDAR_HANDLERS.clear()

  const imports = foundFunctions.map(async (fnPath) => {
    const ts = Date.now()
    const routeName = path.basename(fnPath).replace('.js', '')
    const routePath = routeName === 'graphql' ? '/graphql' : `/${routeName}`

    const fnImport = await import(pathToFileURL(fnPath).href)
    const handler: Handler = (() => {
      if ('handler' in fnImport) {
        // ESModule export of handler - when using
        // `export const handler = ...` - most common case
        return fnImport.handler
      }

      if ('default' in fnImport) {
        if ('handler' in fnImport.default) {
          // CommonJS export of handler - when using
          // `module.exports.handler = ...` or `export default { handler: ... }`
          // This is less common, but required for bundling tools that export a
          // default object, like esbuild and rollup
          return fnImport.default.handler
        }

        // Default export is not expected, so skip it
      }

      // If no handler is found, return undefined - we do not want to throw an
      // error
      return undefined
    })()

    const cedarHandler: CedarHandler | undefined = (() => {
      if (
        'handleRequest' in fnImport &&
        typeof fnImport.handleRequest === 'function'
      ) {
        return fnImport.handleRequest as CedarHandler
      }

      if (
        'default' in fnImport &&
        fnImport.default &&
        'handleRequest' in fnImport.default &&
        typeof fnImport.default.handleRequest === 'function'
      ) {
        return fnImport.default.handleRequest as CedarHandler
      }

      return undefined
    })()

    LAMBDA_FUNCTIONS.set(routeName, handler)

    if (cedarHandler) {
      CEDAR_HANDLERS.set(routeName, cedarHandler)
    } else if (handler) {
      CEDAR_HANDLERS.set(routeName, wrapLegacyHandler(handler as LegacyHandler))
    }

    if (!handler && !cedarHandler) {
      console.warn(
        routeName,
        'at',
        fnPath,
        'does not have a function called handler or handleRequest defined.',
      )
    }

    cedarRouteManifest.push({
      path: routePath,
      methods:
        routeName === 'graphql' ? ['GET', 'POST', 'OPTIONS'] : ['GET', 'POST'],
      type:
        routeName === 'graphql'
          ? 'graphql'
          : routeName === 'health'
            ? 'health'
            : routeName.toLowerCase().includes('auth')
              ? 'auth'
              : 'function',
      entry: fnPath,
    })

    // TODO: Use terminal link.
    console.log(
      ansis.magenta('/' + routeName),
      ansis.dim.italic(Date.now() - ts + ' ms'),
    )
  })

  await Promise.all(imports)

  console.log(
    ansis.dim.italic('...Done importing in ' + (Date.now() - tsImport) + ' ms'),
  )
}

type LoadFunctionsFromDistOptions = {
  fastGlobOptions?: FastGlobOptions
  discoverFunctionsGlob?: string | string[]
}

// TODO: Use v8 caching to load these crazy fast.
export const loadFunctionsFromDist = async (
  options: LoadFunctionsFromDistOptions = {},
) => {
  const serverFunctions = findApiDistFunctions({
    cwd: getPaths().api.base,
    options: options?.fastGlobOptions,
    discoverFunctionsGlob: options?.discoverFunctionsGlob,
  })

  // Place `GraphQL` serverless function at the start.
  const i = serverFunctions.findIndex((x) => path.basename(x) === 'graphql.js')
  if (i >= 0) {
    const graphQLFn = serverFunctions.splice(i, 1)[0]
    serverFunctions.unshift(graphQLFn)
  }
  await setLambdaFunctions(serverFunctions)
}

// NOTE: Copied from @cedarjs/internal/dist/files to avoid depending on
// @cedarjs/internal.
// import { findApiDistFunctions } from '@cedarjs/internal/dist/files'
const findApiDistFunctions = (params: {
  cwd: string
  options?: FastGlobOptions
  discoverFunctionsGlob?: string | string[]
}) => {
  const {
    cwd = getPaths().api.base,
    options = {},
    discoverFunctionsGlob = 'dist/functions/**/*.{ts,js}',
  } = params

  return fg.sync(discoverFunctionsGlob, {
    cwd,
    // We don't support deeply nested api functions, to maximise compatibility
    // with deployment providers
    deep: 2,
    absolute: true,
    ...options,
  })
}

interface LambdaHandlerRequest extends RequestGenericInterface {
  Params: {
    routeName: string
  }
}

/**
 This will take a fastify request
 Then convert it to a lambdaEvent, and pass it to the the appropriate handler
 for the routeName
 The LAMBDA_FUNCTIONS map has been populated already by this point
 **/
export const lambdaRequestHandler = async (
  req: FastifyRequest<LambdaHandlerRequest>,
  reply: FastifyReply,
) => {
  const { routeName } = req.params
  const cedarHandlerCandidate = CEDAR_HANDLERS.get(routeName)
  const cedarHandler =
    typeof cedarHandlerCandidate === 'function'
      ? cedarHandlerCandidate
      : undefined

  if (cedarHandler) {
    const requestBody =
      req.method === 'GET' || req.method === 'HEAD'
        ? undefined
        : typeof req.rawBody === 'string'
          ? req.rawBody
          : req.rawBody
            ? Buffer.from(req.rawBody).toString()
            : undefined

    const href = `${req.protocol}://${req.hostname}${req.raw.url ?? '/'}`
    const request = new Request(href, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: requestBody,
    })

    const ctx = await buildCedarContext(request, {
      params: {
        routeName,
      },
    })

    const response = await cedarHandler(request, ctx)

    reply.status(response.status)

    response.headers.forEach((value: string, name: string) => {
      reply.header(name, value)
    })

    const body = await response.arrayBuffer()
    reply.send(Buffer.from(body))

    return
  }

  const func = LAMBDA_FUNCTIONS.get(routeName)

  if (func) {
    return requestHandler(req, reply, func)
  } else {
    const errorMessage = `Function "${routeName}" was not found.`
    req.log.error(errorMessage)
    reply.status(404)

    if (process.env.NODE_ENV === 'development') {
      const devError = {
        error: errorMessage,
        availableFunctions: [
          ...new Set([...LAMBDA_FUNCTIONS.keys(), ...CEDAR_HANDLERS.keys()]),
        ],
      }
      reply.send(devError)
    } else {
      reply.send(escape(errorMessage))
    }

    return
  }
}
