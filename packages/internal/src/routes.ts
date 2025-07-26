import ansis from 'ansis'

export interface RouteInformation {
  name?: string
  path?: string
  page?: string
}

/**
 * Returns an array of routes which conflict on their defined names
 * TODO: Implement proper route detection when structure package is stable
 */
export function getDuplicateRoutes(): RouteInformation[] {
  // Stub implementation - returns empty array
  return []
}

/**
 * Detects any potential duplicate routes and returns a formatted warning message
 * @see {@link getDuplicateRoutes} for how duplicate routes are detected
 * @return {string} Warning message when duplicate routes found, empty string if not
 */
export function warningForDuplicateRoutes(): string {
  const duplicatedRoutes = getDuplicateRoutes()
  let message = ''
  if (duplicatedRoutes.length > 0) {
    message += ansis.hex('#ffa500')(
      `Warning: ${duplicatedRoutes.length} duplicate routes have been detected, only the route(s) closest to the top of the file will be used.\n`,
    )
    duplicatedRoutes.forEach((route) => {
      message += ` ${ansis.hex('#ffa500')('->')} Name: "${
        route.name
      }", Path: "${route.path}", Page: "${route.page}"\n`
    })
  }
  return message.trimEnd()
}

export interface RWRouteManifestItem {
  name: string
  pathDefinition: string
  matchRegexString: string | null
  routeHooks: string | null
  bundle: string | null
  hasParams: boolean
  relativeFilePath: string
  redirect: { to: string; permanent: boolean } | null
  isPrivate: boolean
  unauthenticated: string | null
  roles: string | string[] | null
  pageIdentifier: string | null
  // Probably want isNotFound here, so we can attach a separate 404 handler
}

export interface RouteSpec extends RWRouteManifestItem {
  id: string
  isNotFound: boolean
  filePath: string | undefined
  isPrivate: boolean
  unauthenticated: string | null
  relativeFilePath: string
}

/**
 * TODO: Implement proper route detection when structure package is stable
 */
export const getProjectRoutes = (): RouteSpec[] => {
  // Stub implementation - returns empty array
  return []
}
