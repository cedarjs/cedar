import path from 'path'

import prismaConfig from '@prisma/config'
const { loadConfigFromFile } = prismaConfig

import { getPaths } from '@cedarjs/project-config'

export function getDefaultDb(projectBaseDir: string) {
  return `file:${path.join(projectBaseDir, '.redwood', 'test.db')}`
}

// In Prisma v6 users can have something like
// `directUrl = env("DATABASE_URL")`
// in their schema.prisma file. Prisma would then use the value of the
// DATABASE_URL environment variable for the direct URL. It uses the direct
// URL when running Prisma CLI commands like `prisma migrate` etc.
// During testing we need to override DATABASE_URL to use TEST_DATABASE_URL
// instead. This is easy, and we already do that.
// But users could also have
// `directUrl = env("DIRECT_DATABASE_URL")`
// and in that case we need to override both DIRECT_DATABASE_URL and
// DATABASE_URL to use TEST_DATABASE_URL instead.
// We should also let users specify a unique URL for direct database access
// during testing, if they don't want to use TEST_DATABASE_URL. To do that,
// https://github.com/redwoodjs/graphql/pull/7898 introduced the new
// environment variable TEST_DIRECT_URL.
// One challenge is that we don't know what they have named their direct url
// environment variable. They could have named it anything, like
// `directUrl = env("SUPABASE_DIRECT_DATABASE_URL")` or whatever else they
// want.
// So what we do is we try to parse their schema.prisma file for a
// `directUrl = env(...)` line and use that to determine the environment
// variable name to override.
//
// In Prisma v7 support for `directUrl` in schema.prisma is going away.
// We should however ideally still support exactly the same behavior as
// above.
// Instead of `directUrl` Prisma v7 uses `datasourceUrl` in their config
// file as the url for all cli operations:
// ```
// datasource: {
//   url: env('DATABASE_URL'),
// },
// ```
// So we could "regex parse" the config file for the datasource url, similar
// to how we parse the schema.prisma file for the direct url.
// The problem is that the config file is a standard js/ts file, which
// invites for a much more bespoke configuration. The schema parsing code
// already accounted for non-standard `directUrl` config formats by throwing
// an error if it could not find a valid `directUrl`. For the config file,
// we will simply print a warning if we detect non-standard config.

export async function checkAndReplaceDirectUrl() {
  const cedarPaths = getPaths()

  console.log('configRoot', cedarPaths.api.base)

  const prismaConfig = await loadConfigFromFile({
    configRoot: cedarPaths.api.base,
  })
  // @ts-expect-error - Prisma v7 prep
  const urlFromConfig = prismaConfig.config?.datasource?.url
  console.log('prismaConfig', prismaConfig)

  console.log('urlFromConfig', urlFromConfig)
  console.log('configPath', prismaConfig.resolvedPath)

  // If it is, set its env var to the test equivalent.
  const directUrlEnvMatch = urlFromConfig

  // This is mostly to please TS. But it's good to be safe because in this case
  // we want to be 100% correct.
  if (!directUrlEnvMatch) {
    throw new Error(
      'Error parsing `directUrl` from schema.prisma. Proceeding with this ' +
        'env var could be dangerous. Please check your schema.prisma file; ' +
        'if everything looks ok, file an issue.',
    )
  }

  // `directUrlEnvMatch` look something like
  // `["(DIRECT_URL)", "", "DIRECT_URL"]`. We want the third element.
  const directUrlEnv = directUrlEnvMatch[2]

  const defaultDb = getDefaultDb(cedarPaths.base)
  process.env[directUrlEnv] =
    process.env.TEST_DIRECT_URL || process.env.TEST_DATABASE_URL || defaultDb

  return directUrlEnv
}
