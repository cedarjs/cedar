import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

/**
 * Drop the cedar-pg test database after the Jest api suite finishes.
 */
export default async function () {
  const cedarPgOn =
    process.env.CEDAR_PG === '1' || process.env.CEDAR_PG === 'true'
  if (!cedarPgOn) {
    return
  }

  const cedarPaths = getPaths()
  // dispose() is lease-gated: no-op when ensure was skipped (escape hatch)
  try {
    const { createRequire } = await import('node:module')
    const { pathToFileURL } = await import('node:url')
    const require = createRequire(
      path.join(cedarPaths.api.base, 'package.json'),
    )
    const resolved = require.resolve('cedar-pg')
    const cedarPg = await import(pathToFileURL(resolved).href)
    await cedarPg.dispose({ root: cedarPaths.base, mode: 'test' })
  } catch {
    // best-effort
  }
}
