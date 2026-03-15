import fs from 'node:fs'

import Enquirer from 'enquirer'

import { getPaths } from '@cedarjs/project-config'

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

// Parses the Prisma config file for a non-standard datasource url env var
// (i.e. anything other than DATABASE_URL), warns the user, and prompts them
// to confirm before continuing. This must be called before Jest/Vitest starts,
// while the process still has an interactive TTY attached.
export async function warnIfNonStandardDatasourceUrl() {
  const cedarPaths = getPaths()

  if (!fs.existsSync(cedarPaths.api.prismaConfig)) {
    // No Prisma config file found – nothing to warn about.
    return
  }

  const prismaConfig = await fs.promises.readFile(
    cedarPaths.api.prismaConfig,
    'utf-8',
  )

  const prismaConfigLines = prismaConfig.split('\n')

  for (const line of prismaConfigLines) {
    // The last two patterns are for lines like the ones below:
    // datasource: { url: env('DATABASE_URL') },
    // datasource: { foo: 'bar', url: env('DATABASE_URL'), '1baz': '' },
    const envVarName = (line.match(
      /^\s*url: process\.env\.(\w+),?(\s*\/\/.*)?$/,
    ) ??
      line.match(/^\s*url: env\(['"](\w+)['"]\),?(\s*\/\/.*)?$/) ??
      line.match(/[{,] url: process\.env\.(\w+)(?:,| })/) ??
      line.match(/[{,] url: env\(['"](\w+)['"]\)(?:,| })/))?.[1]

    if (envVarName && envVarName !== 'DATABASE_URL') {
      console.warn(
        'Found a non-standard prisma config datasource url env var: ' +
          `"${envVarName}". Cedar will override this env var with ` +
          'TEST_DIRECT_URL, TEST_DATABASE_URL, or the default test DB.',
      )

      const { proceed } = await Enquirer.prompt<{ proceed: boolean }>({
        type: 'confirm',
        name: 'proceed',
        message: 'Are you sure you want to run tests against this database?',
        initial: false,
      })

      if (!proceed) {
        console.log('Aborting.')
        process.exit(1)
      }

      // Only need to find and warn about the first datasource url match.
      return
    }
  }
}
