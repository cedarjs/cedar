import type {
  APIGatewayProxyResult,
  APIGatewayProxyEvent,
  Handler,
  APIGatewayProxyEventQueryStringParameters,
} from 'aws-lambda'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { parse } from 'picoquery'

import { mergeMultiValueHeaders, parseBody } from './utils.js'

export const lambdaEventForFastifyRequest = (
  request: FastifyRequest,
): APIGatewayProxyEvent => {
  // @ts-expect-error - Used to use `qs` for this, which just hid the fact that
  // we could be getting arrays etc from the query string
  const qsParams: APIGatewayProxyEventQueryStringParameters = parse(
    request.url.split(/\?(.+)/)[1],
    {
      nestingSyntax: 'index',
      arrayRepeat: true,
      arrayRepeatSyntax: 'bracket',
    },
  )

  return {
    httpMethod: request.method,
    headers: request.headers,
    multiValueHeaders: {},
    path: request.urlData('path'),
    pathParameters: null,
    queryStringParameters: qsParams,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: request.id,
      identity: {
        sourceIp: request.ip,
      },
    },
    resource: request.urlData('path') ?? request.url,
    ...parseBody(request.rawBody || ''), // adds `body` and `isBase64Encoded`
    // Safe at this Fastify-to-Lambda boundary: we populate the APIGatewayProxyEvent
    // fields Cedar's legacy handlers rely on, and the remaining fields are optional
    // in practice across our supported adapters.
  } as unknown as APIGatewayProxyEvent
}

const fastifyResponseForLambdaResult = (
  reply: FastifyReply,
  lambdaResult: APIGatewayProxyResult,
) => {
  const {
    statusCode = 200,
    headers,
    body = '',
    multiValueHeaders,
  } = lambdaResult
  const mergedHeaders = mergeMultiValueHeaders(headers, multiValueHeaders)
  Object.entries(mergedHeaders).forEach(([name, values]) =>
    values.forEach((value) => reply.header(name, value)),
  )
  reply.status(statusCode)

  if (lambdaResult.isBase64Encoded) {
    // Correctly handle base 64 encoded binary data. See
    // https://aws.amazon.com/blogs/compute/handling-binary-data-using-amazon-api-gateway-http-apis
    return reply.send(Buffer.from(body, 'base64'))
  } else {
    return reply.send(body)
  }
}

const fastifyResponseForLambdaError = (
  req: FastifyRequest,
  reply: FastifyReply,
  error: Error,
) => {
  req.log.error(error)
  reply.status(500).send()
}

export const requestHandler = async (
  req: FastifyRequest,
  reply: FastifyReply,
  handler: Handler,
) => {
  // We take the fastify request object and convert it into a lambda function event.
  const event = lambdaEventForFastifyRequest(req)

  const handlerCallback =
    (reply: FastifyReply) =>
    (error: Error, lambdaResult: APIGatewayProxyResult) => {
      if (error) {
        fastifyResponseForLambdaError(req, reply, error)
        return
      }

      fastifyResponseForLambdaResult(reply, lambdaResult)
    }

  // Execute the lambda function.
  // https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-handler.html
  const handlerPromise = handler(
    event,
    // @ts-expect-error - Add support for context: https://github.com/DefinitelyTyped/DefinitelyTyped/blob/0bb210867d16170c4a08d9ce5d132817651a0f80/types/aws-lambda/index.d.ts#L443-L467
    {},
    handlerCallback(reply),
  )

  // In this case the handlerCallback should not be called.
  if (handlerPromise && typeof handlerPromise.then === 'function') {
    try {
      const lambdaResponse = await handlerPromise

      return fastifyResponseForLambdaResult(reply, lambdaResponse)
    } catch (error: any) {
      return fastifyResponseForLambdaError(req, reply, error)
    }
  }
}
