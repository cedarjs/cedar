import { getConfig, readEnvVar } from '@cedarjs/project-config'

interface SideOptions {
  /**
   * Whether this side receives the deployment's public traffic.
   *
   * Container hosts (Railway, Render, Fly.io, Cloud Run, Heroku) tell an app
   * which host and port to bind with the `HOST` and `PORT` env vars. Only the
   * side serving public traffic falls back to them — when the api and web
   * servers run in the same deployment they would otherwise both bind to
   * `PORT` and collide.
   *
   * The web side is the public one whenever both sides are served together,
   * because it proxies api requests. The api side is only public when it is
   * served on its own.
   */
  isPublicSide?: boolean
}

function parsePort(value: string, envVarName: string) {
  const port = parseInt(value, 10)

  if (Number.isNaN(port)) {
    throw new Error(
      `Invalid ${envVarName} env var: "${value}". Must be an integer.`,
    )
  }

  return port
}

export function getAPIHost({ isPublicSide = false }: SideOptions = {}) {
  let host = readEnvVar('CEDAR_API_HOST', {
    deprecatedAlias: 'REDWOOD_API_HOST',
  })

  if (isPublicSide) {
    host ??= process.env.HOST
  }

  host ??= getConfig().api.host
  host ??= process.env.NODE_ENV === 'production' ? '0.0.0.0' : '::'
  return host
}

export function getAPIPort({ isPublicSide = false }: SideOptions = {}) {
  const apiPort = readEnvVar('CEDAR_API_PORT', {
    deprecatedAlias: 'REDWOOD_API_PORT',
  })

  if (apiPort) {
    return parsePort(apiPort, 'CEDAR_API_PORT')
  }

  if (isPublicSide && process.env.PORT) {
    return parsePort(process.env.PORT, 'PORT')
  }

  return getConfig().api.port
}

export function getAPIRootPath() {
  return process.env.CEDAR_API_ROOT_PATH ?? '/'
}

export function getWebHost({ isPublicSide = false }: SideOptions = {}) {
  let host = readEnvVar('CEDAR_WEB_HOST', {
    deprecatedAlias: 'REDWOOD_WEB_HOST',
  })

  if (isPublicSide) {
    host ??= process.env.HOST
  }

  host ??= getConfig().web.host
  host ??= process.env.NODE_ENV === 'production' ? '0.0.0.0' : '::'
  return host
}

export function getWebPort({ isPublicSide = false }: SideOptions = {}) {
  const webPort = readEnvVar('CEDAR_WEB_PORT', {
    deprecatedAlias: 'REDWOOD_WEB_PORT',
  })

  if (webPort) {
    return parsePort(webPort, 'CEDAR_WEB_PORT')
  }

  if (isPublicSide && process.env.PORT) {
    return parsePort(process.env.PORT, 'PORT')
  }

  return getConfig().web.port
}
