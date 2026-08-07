import { logger } from 'src/lib/logger'

/**
 * The handler function is your code that processes http request events.
 * You can use return and throw to send a response or error, respectively.
 *
 * Important: When deployed, a custom serverless function is an open API endpoint and
 * is your responsibility to secure appropriately.
 *
 * @see {@link https://cedarjs.com/docs/serverless-functions#security-considerations|Serverless Function Considerations}
 * in the RedwoodJS documentation for more information.
 *
 * @typedef { import('aws-lambda').APIGatewayEvent } APIGatewayEvent
 * @typedef { import('aws-lambda').Context } Context
 * @param { APIGatewayEvent } event - an object which contains information from the invoker.
 * @param { Context } context - contains information about the invocation,
 * function, and execution environment.
 */
import { getAsyncStoreInstance as __cedar_getAsyncStoreInstance } from '@cedarjs/context/dist/store'
const __cedar_handler = async (event, _context) => {
  logger.info(`${event.httpMethod} ${event.path}: custom function`)
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: 'custom function',
    }),
  }
}
export const handler = async (__cedar_event, __cedar_context) => {
  // The store will be undefined if no context isolation has been performed yet
  const __cedar_contextStore = __cedar_getAsyncStoreInstance().getStore()
  if (__cedar_contextStore === undefined) {
    return __cedar_getAsyncStoreInstance().run(
      new Map(),
      __cedar_handler,
      __cedar_event,
      __cedar_context
    )
  }
  return __cedar_handler(__cedar_event, __cedar_context)
}
