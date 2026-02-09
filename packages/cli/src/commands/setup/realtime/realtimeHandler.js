import fs from 'node:fs'
import path from 'path'

import execa from 'execa'
import { Listr } from 'listr2'
import prompts from 'prompts'

import { addApiPackages } from '@cedarjs/cli-helpers'
import { projectIsEsm } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import c from '../../../lib/colors.js'
import { getPaths, transformTSToJS, writeFile } from '../../../lib/index.js'
import { isTypeScriptProject, serverFileExists } from '../../../lib/project.js'
import { setupServerFileTasks } from '../server-file/serverFileHandler.js'

import { addRealtimeToGraphqlHandler } from './addRealtimeToGraphql.js'

const { version } = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, '../../../../package.json'),
    'utf-8',
  ),
)

async function handleExamplesPreference(includeExamples) {
  let incl = includeExamples

  if (typeof includeExamples === 'undefined') {
    const response = await prompts({
      type: 'toggle',
      name: 'includeExamples',
      message: 'Do you want to generate examples?',
      initial: true,
      active: 'Yes',
      inactive: 'No',
    })

    incl = response.includeExamples
  }

  return incl
}

export async function handler(args) {
  const redwoodPaths = getPaths()
  const ts = isTypeScriptProject()

  const realtimeLibFilePath = path.join(
    redwoodPaths.api.lib,
    `realtime.${isTypeScriptProject() ? 'ts' : 'js'}`,
  )
  const force = args.force || false
  const verbose = args.verbose || false

  const includeExamples = await handleExamplesPreference(args.includeExamples)

  const tasks = new Listr(
    [
      addApiPackages(['ioredis@^5', `@cedarjs/realtime@${version}`]),
      {
        title: 'Adding the realtime api lib...',
        task: async () => {
          const serverFileTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'realtime.ts.template',
            ),
            'utf-8',
          )

          const setupScriptContent = ts
            ? serverFileTemplateContent
            : await transformTSToJS(
                realtimeLibFilePath,
                serverFileTemplateContent,
              )

          return [
            writeFile(realtimeLibFilePath, setupScriptContent, {
              overwriteExisting: force,
            }),
          ]
        },
      },
      {
        title: 'Enabling realtime support in the GraphQL handler...',
        task: (ctx, task) => {
          addRealtimeToGraphqlHandler(ctx, task, force)
        },
      },
      {
        title: 'Adding Countdown example subscription...',
        enabled: () => includeExamples,
        task: async () => {
          let exampleSubscriptionTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'subscriptions',
              'countdown',
              `countdown.ts.template`,
            ),
            'utf-8',
          )

          if (projectIsEsm()) {
            exampleSubscriptionTemplateContent =
              exampleSubscriptionTemplateContent.replace(
                "import gql from 'graphql-tag'",
                "import { gql } from 'graphql-tag'",
              )
          }

          const exampleFile = path.join(
            redwoodPaths.api.subscriptions,
            'countdown',
            `countdown.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const setupScriptContent = ts
            ? exampleSubscriptionTemplateContent
            : await transformTSToJS(
                exampleFile,
                exampleSubscriptionTemplateContent,
              )

          return [
            writeFile(exampleFile, setupScriptContent, {
              overwriteExisting: force,
            }),
          ]
        },
      },
      {
        title: 'Adding NewMessage example subscription...',
        enabled: () => includeExamples,
        task: async () => {
          // sdl

          const exampleSdlTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'subscriptions',
              'newMessage',
              `rooms.sdl.ts.template`,
            ),
            'utf-8',
          )

          const sdlFile = path.join(
            redwoodPaths.api.graphql,
            `rooms.sdl.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const sdlContent = ts
            ? exampleSdlTemplateContent
            : await transformTSToJS(sdlFile, exampleSdlTemplateContent)

          // service

          const exampleServiceTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'subscriptions',
              'newMessage',
              `rooms.ts.template`,
            ),
            'utf-8',
          )
          const serviceFile = path.join(
            redwoodPaths.api.services,
            'rooms',
            `rooms.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const serviceContent = ts
            ? exampleServiceTemplateContent
            : await transformTSToJS(serviceFile, exampleServiceTemplateContent)

          // subscription

          let exampleSubscriptionTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'subscriptions',
              'newMessage',
              'newMessage.ts.template',
            ),
            'utf-8',
          )

          if (projectIsEsm()) {
            exampleSubscriptionTemplateContent =
              exampleSubscriptionTemplateContent.replace(
                "import gql from 'graphql-tag'",
                "import { gql } from 'graphql-tag'",
              )
          }

          const exampleFile = path.join(
            redwoodPaths.api.subscriptions,
            'newMessage',
            `newMessage.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const setupScriptContent = ts
            ? exampleSubscriptionTemplateContent
            : await transformTSToJS(
                exampleFile,
                exampleSubscriptionTemplateContent,
              )

          // write all files
          return [
            writeFile(sdlFile, sdlContent, {
              overwriteExisting: force,
            }),
            writeFile(serviceFile, serviceContent, {
              overwriteExisting: force,
            }),
            writeFile(exampleFile, setupScriptContent, {
              overwriteExisting: force,
            }),
          ]
        },
      },
      {
        title: 'Adding Auctions example live query...',
        enabled: () => includeExamples,
        task: async () => {
          // sdl

          const exampleSdlTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'liveQueries',
              'auctions',
              `auctions.sdl.ts.template`,
            ),
            'utf-8',
          )

          const sdlFile = path.join(
            redwoodPaths.api.graphql,
            `auctions.sdl.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const sdlContent = ts
            ? exampleSdlTemplateContent
            : await transformTSToJS(sdlFile, exampleSdlTemplateContent)

          // service

          const exampleServiceTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'liveQueries',
              'auctions',
              `auctions.ts.template`,
            ),
            'utf-8',
          )
          const serviceFile = path.join(
            redwoodPaths.api.services,
            'auctions',
            `auctions.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const serviceContent = ts
            ? exampleServiceTemplateContent
            : await transformTSToJS(serviceFile, exampleServiceTemplateContent)

          // write all files
          return [
            writeFile(sdlFile, sdlContent, {
              overwriteExisting: force,
            }),
            writeFile(serviceFile, serviceContent, {
              overwriteExisting: force,
            }),
          ]
        },
      },

      {
        title: 'Adding Defer example queries...',
        enabled: () => includeExamples,
        task: async () => {
          // sdl

          const exampleSdlTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'defer',
              'fastAndSlowFields',
              `fastAndSlowFields.sdl.template`,
            ),
            'utf-8',
          )

          const sdlFile = path.join(
            redwoodPaths.api.graphql,
            `fastAndSlowFields.sdl.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const sdlContent = ts
            ? exampleSdlTemplateContent
            : await transformTSToJS(sdlFile, exampleSdlTemplateContent)

          // service

          const exampleServiceTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'defer',
              'fastAndSlowFields',
              `fastAndSlowFields.ts.template`,
            ),
            'utf-8',
          )
          const serviceFile = path.join(
            redwoodPaths.api.services,
            'fastAndSlowFields',
            `fastAndSlowFields.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const serviceContent = ts
            ? exampleServiceTemplateContent
            : await transformTSToJS(serviceFile, exampleServiceTemplateContent)

          // write all files
          return [
            writeFile(sdlFile, sdlContent, {
              overwriteExisting: force,
            }),
            writeFile(serviceFile, serviceContent, {
              overwriteExisting: force,
            }),
          ]
        },
      },

      {
        title: 'Adding Stream example queries...',
        enabled: () => includeExamples,
        task: async () => {
          // sdl

          const exampleSdlTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'stream',
              'alphabet',
              `alphabet.sdl.template`,
            ),
            'utf-8',
          )

          const sdlFile = path.join(
            redwoodPaths.api.graphql,
            `alphabet.sdl.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const sdlContent = ts
            ? exampleSdlTemplateContent
            : await transformTSToJS(sdlFile, exampleSdlTemplateContent)

          // service

          const exampleServiceTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'stream',
              'alphabet',
              `alphabet.ts.template`,
            ),
            'utf-8',
          )
          const serviceFile = path.join(
            redwoodPaths.api.services,
            'alphabet',
            `alphabet.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const serviceContent = ts
            ? exampleServiceTemplateContent
            : await transformTSToJS(serviceFile, exampleServiceTemplateContent)

          // write all files
          return [
            writeFile(sdlFile, sdlContent, {
              overwriteExisting: force,
            }),
            writeFile(serviceFile, serviceContent, {
              overwriteExisting: force,
            }),
          ]
        },
      },
      {
        title: `Generating types...`,
        task: async () => {
          const { generate } =
            await import('@cedarjs/internal/dist/generate/generate')

          await generate()

          console.log(
            'Note: You may need to manually restart GraphQL in VSCode to see ' +
              'the new types take effect.\n\n',
          )
        },
      },
      {
        title: 'Cleaning up...',
        task: () => {
          const graphqlHandlerPath = path.join(
            getPaths().api.functions,
            `graphql.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          execa.sync(
            'yarn',
            ['cedar', 'lint', '--fix', graphqlHandlerPath, realtimeLibFilePath],
            {
              cwd: getPaths().base,
              // Silently ignore errors
              reject: false,
            },
          )
        },
      },
    ],
    {
      rendererOptions: { collapseSubtasks: false, persistentOutput: true },
      renderer: verbose ? 'verbose' : 'default',
    },
  )

  try {
    if (!serverFileExists()) {
      tasks.add(setupServerFileTasks({ force }))
    }

    await tasks.run()

    if (tasks.ctx?.realtimeHandlerSkipped) {
      const graphqlHandlerPath = path.join(
        getPaths().api.functions,
        `graphql.${isTypeScriptProject() ? 'ts' : 'js'}`,
      )
      const relativePath = path.relative(getPaths().base, graphqlHandlerPath)

      console.log()
      console.log(
        c.warning(
          'Note: The setup command skipped adding realtime to your GraphQL ' +
            `handler. Please review ${relativePath}, and manually add it if ` +
            'needed.',
        ),
      )
      console.log(
        'You want to make sure you have an import like `import { realtime } ' +
          "from '@cedarjs/realtime'`, and that you pass `realtime` to the " +
          'call to `createGraphQLHandler`.',
      )
    }
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
