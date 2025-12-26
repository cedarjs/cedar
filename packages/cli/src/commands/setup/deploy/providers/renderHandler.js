import path from 'path'

import prismaInternals from '@prisma/internals'
import fs from 'fs-extra'
import { Listr } from 'listr2'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import c from '../../../../lib/colors.js'
import {
  getPaths,
  writeFilesTask,
  printSetupNotes,
} from '../../../../lib/index.js'
import { addFilesTask, updateApiURLTask } from '../helpers/index.js'
import {
  POSTGRES_YAML,
  RENDER_HEALTH_CHECK,
  RENDER_YAML,
  SQLITE_YAML,
} from '../templates/render.js'

const { getSchemaWithPath, getConfig } = prismaInternals

const getRenderYamlContent = async (database) => {
  if (database === 'none') {
    return {
      path: path.join(getPaths().base, 'render.yaml'),
      content: RENDER_YAML(''),
    }
  }
  if (!fs.existsSync('api/db/schema.prisma')) {
    throw new Error("Could not find prisma schema at 'api/db/schema.prisma'")
  }

  const { schemas } = await getSchemaWithPath('api/db/schema.prisma')
  const config = await getConfig({ datamodel: schemas })
  const detectedDatabase = config.datasources[0].activeProvider

  if (detectedDatabase === database) {
    switch (database) {
      case 'postgresql':
        return {
          path: path.join(getPaths().base, 'render.yaml'),
          content: RENDER_YAML(POSTGRES_YAML),
        }
      case 'sqlite':
        return {
          path: path.join(getPaths().base, 'render.yaml'),
          content: RENDER_YAML(SQLITE_YAML),
        }
      default:
        throw new Error(`
       Unexpected datasource provider found: ${database}`)
    }
  } else {
    throw new Error(`
    Prisma datasource provider is detected to be ${detectedDatabase}.

    Option 1: Update your schema.prisma provider to be ${database}, then run
    yarn cedar prisma migrate dev
    yarn cedar setup deploy render --database ${database}

    Option 2: Rerun setup deploy command with current schema.prisma provider:
    yarn cedar setup deploy render --database ${detectedDatabase}`)
  }
}

// any notes to print out when the job is done
const notes = [
  'You are ready to deploy to Render!\n',
  'Go to https://dashboard.render.com/iacs to create your account and deploy to Render',
  'Check out the deployment docs at https://render.com/docs/deploy-redwood for detailed instructions',
  'Note: After first deployment to Render update the rewrite rule destination in `./render.yaml`',
]

const additionalFiles = [
  {
    path: path.join(getPaths().base, 'api/src/functions/healthz.js'),
    content: RENDER_HEALTH_CHECK,
  },
]

export const handler = async ({ force, database }) => {
  recordTelemetryAttributes({
    command: 'setup deploy render',
    force,
    database,
  })
  const tasks = new Listr(
    [
      {
        title: 'Adding render.yaml',
        task: async () => {
          const fileData = await getRenderYamlContent(database)
          let files = {}
          files[fileData.path] = fileData.content
          return writeFilesTask(files, { overwriteExisting: force })
        },
      },
      updateApiURLTask('/.redwood/functions'),
      // Add health check api function
      addFilesTask({
        files: additionalFiles,
        force,
      }),
      printSetupNotes(notes),
    ],
    { rendererOptions: { collapseSubtasks: false } },
  )

  try {
    await tasks.run()
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
