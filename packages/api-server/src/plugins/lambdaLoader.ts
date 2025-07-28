import path from 'path'

import ansis from 'ansis'
import type { Handler } from 'aws-lambda'
import fg from 'fast-glob'
import type { Options as FastGlobOptions } from 'fast-glob'
import type {
  FastifyReply,
  FastifyRequest,
  RequestGenericInterface,
} from 'fastify'

import { getPaths } from '@cedarjs/project-config'

import { requestHandler } from '../requestHandlers/awsLambdaFastify.js'
import { escape } from '../utils.js'

// Diagnostic logging for timeout debugging
const isDiagnosticMode =
  process.env.NODE_ENV === 'test' && process.env.CEDAR_DEBUG_TIMEOUT
function debugLog(message: string) {
  if (isDiagnosticMode) {
    console.log(`[CEDAR_DEBUG] ${new Date().toISOString()} - ${message}`)
  }
}

export type Lambdas = Record<string, Handler>
export const LAMBDA_FUNCTIONS: Lambdas = {}

// Import the API functions and add them to the LAMBDA_FUNCTIONS object

export const setLambdaFunctions = async (foundFunctions: string[]) => {
  debugLog(
    `setLambdaFunctions: Starting import of ${foundFunctions.length} functions`,
  )
  const tsImport = Date.now()
  console.log(ansis.dim.italic('Importing Server Functions... '))

  const imports = foundFunctions.map(async (fnPath) => {
    const ts = Date.now()
    const routeName = path.basename(fnPath).replace('.js', '')

    debugLog(
      `setLambdaFunctions: Importing function ${routeName} from ${fnPath}`,
    )
    const fnImport = await import(`file://${fnPath}`)
    debugLog(`setLambdaFunctions: Import of ${routeName} completed`)
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

    LAMBDA_FUNCTIONS[routeName] = handler
    if (!handler) {
      console.warn(
        routeName,
        'at',
        fnPath,
        'does not have a function called handler defined.',
      )
    }
    // TODO: Use terminal link.
    console.log(
      ansis.magenta('/' + routeName),
      ansis.dim.italic(Date.now() - ts + ' ms'),
    )
  })

  debugLog('setLambdaFunctions: Waiting for all imports to complete')
  await Promise.all(imports)
  debugLog('setLambdaFunctions: All imports completed')

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
  debugLog('loadFunctionsFromDist: Starting function discovery')
  const serverFunctions = findApiDistFunctions({
    cwd: getPaths().api.base,
    options: options?.fastGlobOptions,
    discoverFunctionsGlob: options?.discoverFunctionsGlob,
  })
  debugLog(
    `loadFunctionsFromDist: Found ${serverFunctions.length} functions: ${serverFunctions.map((f) => path.basename(f)).join(', ')}`,
  )

  // Place `GraphQL` serverless function at the start.
  const i = serverFunctions.findIndex((x) => path.basename(x) === 'graphql.js')
  if (i >= 0) {
    const graphQLFn = serverFunctions.splice(i, 1)[0]
    serverFunctions.unshift(graphQLFn)
    debugLog('loadFunctionsFromDist: Moved GraphQL function to front')
  }
  debugLog('loadFunctionsFromDist: Starting function loading')
  await setLambdaFunctions(serverFunctions)
  debugLog('loadFunctionsFromDist: Function loading complete')
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
 Then convert it to a lambdaEvent, and pass it to the the appropriate handler for the routeName
 The LAMBDA_FUNCTIONS lookup has been populated already by this point
 **/
export const lambdaRequestHandler = async (
  req: FastifyRequest<LambdaHandlerRequest>,
  reply: FastifyReply,
) => {
  const { routeName } = req.params

  if (!LAMBDA_FUNCTIONS[routeName]) {
    const errorMessage = `Function "${routeName}" was not found.`
    req.log.error(errorMessage)
    reply.status(404)

    if (process.env.NODE_ENV === 'development') {
      const devError = {
        error: errorMessage,
        availableFunctions: Object.keys(LAMBDA_FUNCTIONS),
      }
      reply.send(devError)
    } else {
      reply.send(escape(errorMessage))
    }

    return
  }
  return requestHandler(req, reply, LAMBDA_FUNCTIONS[routeName])
}
