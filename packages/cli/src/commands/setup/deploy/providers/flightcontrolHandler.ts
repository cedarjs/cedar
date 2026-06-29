// import { terminalLink } from 'termi-link'
import fs from 'node:fs'
import { EOL } from 'os'
import path from 'path'

import prismaInternals from '@prisma/internals'
import { Listr } from 'listr2'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { formatCedarCommand } from '@cedarjs/cli-helpers/packageManager/display'
import { getPaths, getPrismaSchemas } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import { writeFilesTask, printSetupNotes } from '../../../../lib/index.js'
import { getUserApiUrl, updateApiURLTask } from '../helpers/index.js'
import {
  getFlightcontrolConfig,
  databaseEnvVariables,
  postgresDatabaseService,
  mysqlDatabaseService,
} from '../templates/flightcontrol.js'

const { getConfig } = prismaInternals

type Database = 'postgresql' | 'mysql' | 'none'

const getFlightcontrolJson = async (database: Database) => {
  const flightcontrolConfig = getFlightcontrolConfig()

  if (database === 'none') {
    return {
      path: path.join(getPaths().base, 'flightcontrol.json'),
      content: flightcontrolConfig,
    }
  }

  const result = await getPrismaSchemas()
  const config = await getConfig({ datamodel: result.schemas })
  const detectedDatabase = config.datasources[0].activeProvider

  if (detectedDatabase === database) {
    let dbService
    switch (database) {
      case 'postgresql':
        dbService = postgresDatabaseService
        break
      case 'mysql':
        dbService = mysqlDatabaseService
        break
      default:
        throw new Error(`
       Unexpected datasource provider found: ${database}`)
    }
    return {
      path: path.join(getPaths().base, 'flightcontrol.json'),
      content: {
        ...flightcontrolConfig,
        environments: [
          {
            ...flightcontrolConfig.environments[0],
            services: [
              ...flightcontrolConfig.environments[0].services.map(
                (service: {
                  id: string
                  envVariables?: Record<string, unknown>
                }) => {
                  if (service.id === 'cedar-api') {
                    return {
                      ...service,
                      envVariables: {
                        ...service.envVariables,
                        ...databaseEnvVariables,
                      },
                    }
                  }
                  return service
                },
              ),
              dbService,
            ],
          },
        ],
      },
    }
  } else {
    throw new Error(`
    Prisma datasource provider is detected to be ${detectedDatabase}.

    Update your schema.prisma provider to be postgresql or mysql, then run
    ${formatCedarCommand(['prisma', 'migrate', 'dev'])}
    ${formatCedarCommand(['setup', 'deploy', 'flightcontrol'])}
    `)
  }
}

const updateGraphQLFunction = () => {
  return {
    title: 'Adding CORS config to createGraphQLHandler...',
    task: () => {
      const graphqlTsPath = path.join(
        getPaths().base,
        'api/src/functions/graphql.ts',
      )
      const graphqlJsPath = path.join(
        getPaths().base,
        'api/src/functions/graphql.js',
      )

      let graphqlFunctionsPath: string | undefined
      if (fs.existsSync(graphqlTsPath)) {
        graphqlFunctionsPath = graphqlTsPath
      } else if (fs.existsSync(graphqlJsPath)) {
        graphqlFunctionsPath = graphqlJsPath
      } else {
        console.log(`
    Couldn't find graphql handler in api/src/functions/graphql.js.
    You'll have to add the following cors config manually:

      cors: { origin: process.env.CEDAR_WEB_URL, credentials: true}
    `)
        return
      }

      const graphqlContent = fs
        .readFileSync(graphqlFunctionsPath, 'utf8')
        .split(EOL)
      const graphqlHanderIndex = graphqlContent.findIndex((line) =>
        line.includes('createGraphQLHandler({'),
      )

      if (graphqlHanderIndex === -1) {
        console.log(`
    Couldn't find graphql handler in api/src/functions/graphql.js.
    You'll have to add the following cors config manually:

      cors: { origin: process.env.CEDAR_WEB_URL, credentials: true}
    `)
        return
      }

      graphqlContent.splice(
        graphqlHanderIndex + 1,
        0,
        '  cors: { origin: process.env.CEDAR_WEB_URL, credentials: true },',
      )

      fs.writeFileSync(graphqlFunctionsPath, graphqlContent.join(EOL))
    },
  }
}

const updateDbAuth = () => {
  return {
    title: 'Updating dbAuth cookie config (if used)...',
    task: () => {
      const authTsPath = path.join(getPaths().base, 'api/src/functions/auth.ts')
      const authJsPath = path.join(getPaths().base, 'api/src/functions/auth.js')

      let authFnPath: string | undefined
      if (fs.existsSync(authTsPath)) {
        authFnPath = authTsPath
      } else if (fs.existsSync(authJsPath)) {
        authFnPath = authJsPath
      } else {
        console.log(`Skipping, did not detect api/src/functions/auth.js`)
        return
      }

      const authContent = fs.readFileSync(authFnPath, 'utf8').split(EOL)
      const sameSiteLineIndex = authContent.findIndex((line) =>
        line.match(/SameSite:.*,/),
      )
      if (sameSiteLineIndex === -1) {
        console.log(`
    Couldn't find cookie SameSite config in api/src/functions/auth.js.

    You need to ensure SameSite is set to "None"
    `)
        return
      }
      authContent[sameSiteLineIndex] =
        `      SameSite: process.env.NODE_ENV === 'development' ? 'Strict' : 'None',`

      const dbHandlerIndex = authContent.findIndex((line) =>
        line.includes('new DbAuthHandler('),
      )
      if (dbHandlerIndex === -1) {
        console.log(`
    Couldn't find DbAuthHandler in api/src/functions/auth.js.
    You'll have to add the following cors config manually:

      cors: { origin: process.env.CEDAR_WEB_URL, credentials: true}
    `)
        return
      }
      authContent.splice(
        dbHandlerIndex + 1,
        0,
        '  cors: { origin: process.env.CEDAR_WEB_URL, credentials: true },',
      )

      fs.writeFileSync(authFnPath, authContent.join(EOL))
    },
  }
}

const updateApp = () => {
  return {
    title: 'Updating App.jsx fetch config...',
    task: () => {
      const appTsPath = path.join(getPaths().base, 'web/src/App.tsx')
      const appJsPath = path.join(getPaths().base, 'web/src/App.jsx')

      let appPath: string | undefined
      if (fs.existsSync(appTsPath)) {
        appPath = appTsPath
      } else if (fs.existsSync(appJsPath)) {
        appPath = appJsPath
      } else {
        console.log(`Skipping, did not detect web/src/App.jsx|tsx`)
        return
      }

      const appContent = fs.readFileSync(appPath, 'utf8').split(EOL)
      const authLineIndex = appContent.findIndex((line) =>
        line.includes('<AuthProvider'),
      )
      if (authLineIndex === -1) {
        console.log(`
    Couldn't find <AuthProvider /> in web/src/App.js
    If (and when) you use *dbAuth*, you'll have to add the following fetch config to <AuthProvider />:

    config={{ fetchConfig: { credentials: 'include' } }}
    `)
      } else if (appContent.toString().match(/dbAuth/)) {
        appContent[authLineIndex] =
          `      <AuthProvider type="dbAuth" config={{ fetchConfig: { credentials: 'include' } }}>
`
      }

      const gqlLineIndex = appContent.findIndex((line) =>
        line.includes('<RedwoodApolloProvider'),
      )
      if (gqlLineIndex === -1) {
        console.log(`
    Couldn't find <RedwoodApolloProvider in web/src/App.js
    If (and when) you use *dbAuth*, you'll have to add the following fetch config manually:

    graphQLClientConfig={{ httpLinkConfig: { credentials: 'include' }}}
    `)
      } else if (appContent.toString().match(/dbAuth/)) {
        appContent[gqlLineIndex] =
          `        <RedwoodApolloProvider graphQLClientConfig={{ httpLinkConfig: { credentials: 'include' }}} >
`
      }

      fs.writeFileSync(appPath, appContent.join(EOL))
    },
  }
}

const addToDotEnvDefaultTask = () => {
  return {
    title: 'Updating .env.defaults...',
    skip: () => {
      if (!fs.existsSync(path.resolve(getPaths().base, '.env.defaults'))) {
        return `
        WARNING: could not update .env.defaults

        You'll have to add the following env var manually:

        CEDAR_API_URL=${getUserApiUrl()}
        `
      }
      return undefined
    },
    task: async () => {
      const env = path.resolve(getPaths().base, '.env.defaults')
      const apiUrl = getUserApiUrl()
      const line = `\n\nCEDAR_API_URL=${apiUrl}\n`

      fs.appendFileSync(env, line)
    },
  }
}

const notes = [
  'You are ready to deploy to Flightcontrol!\n',
  '👉 Create your project at https://app.flightcontrol.dev/signup?ref=redwood\n',
  'Check out the deployment docs at https://app.flightcontrol.dev/docs for detailed instructions\n',
  "NOTE: If you are using yarn v1, remove the installCommand's from flightcontrol.json",
]

export const handler = async ({
  force,
  database,
}: {
  force: boolean
  database: Database
}) => {
  recordTelemetryAttributes({
    command: 'setup deploy flightcontrol',
    force,
    database,
  })
  const tasks = new Listr(
    [
      {
        title: 'Adding flightcontrol.json',
        task: async () => {
          const fileData = await getFlightcontrolJson(database)
          const files: Record<string, string> = {}
          files[fileData.path] = JSON.stringify(fileData.content, null, 2)
          return writeFilesTask(files, { overwriteExisting: force })
        },
      },
      updateGraphQLFunction(),
      updateDbAuth(),
      updateApp(),
      updateApiURLTask('${CEDAR_API_URL}'),
      addToDotEnvDefaultTask(),
      printSetupNotes(notes),
    ],
    { rendererOptions: { collapseSubtasks: false } },
  )

  try {
    await tasks.run()
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    errorTelemetry(process.argv, message)
    console.error(c.error(message))
    const exitCode =
      e instanceof Error && 'exitCode' in e && typeof e.exitCode === 'number'
        ? e.exitCode
        : 1
    process.exit(exitCode)
  }
}
