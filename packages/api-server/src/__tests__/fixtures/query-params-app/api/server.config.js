/** @type {import('fastify').FastifyServerOptions} */
const config = {
  logger: false,
}

/** @type {import('@cedarjs/api-server/dist/types').FastifySideConfigFn} */
const configureFastify = async (fastify, options) => {
  return fastify
}

module.exports = {
  config,
  configureFastify,
}
