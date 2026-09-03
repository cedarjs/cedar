import path from 'path'

import prismaInternals from '@prisma/internals'
import { Listr } from 'listr2'
import prompts from 'prompts'

import { colors as c } from '@cedarjs/cli-helpers/colors'
import { recordTelemetryAttributes } from '@cedarjs/cli-helpers/telemetry'
import { getPaths, getPrismaSchemas } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import { writeFilesTask, printSetupNotes } from '../../../../lib/index.js'
import { POSTGRES_YAML, RENDER_YAML, SQLITE_YAML } from '../templates/render.js'

const { getConfig } = prismaInternals

// Persistent disks (which the `sqlite` option attaches to the api service)
// aren't available on Render's free plan, so that service needs to be on a
// paid plan for the sqlite deploy option to actually work.
const SQLITE_API_PLAN = 'starter'

interface RenderFileData {
  path: string
  content: string
}

const getRenderYamlContent = async (
  database: string,
): Promise<RenderFileData> => {
  if (database === 'none') {
    return {
      path: path.join(getPaths().base, 'render.yaml'),
      content: RENDER_YAML(''),
    }
  }

  const result = await getPrismaSchemas()
  const config = await getConfig({ datamodel: result.schemas })
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
          content: RENDER_YAML(SQLITE_YAML, SQLITE_API_PLAN),
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
  'Check out the deployment docs at https://cedarjs.com/docs/deploy/render for detailed instructions',
  'Note: After first deployment to Render update the rewrite rule destination in `./render.yaml`',
  'Note: The api service now health checks `/graphql/health`. If a previous setup left an unused `api/src/functions/healthz.js` behind, you can delete it',
]

export const handler = async ({
  force,
  database,
}: {
  force: boolean
  database: string
}) => {
  recordTelemetryAttributes({
    command: 'setup deploy render',
    force,
    database,
  })

  // The sqlite option stores its database file on a persistent disk, which
  // Render's free plan doesn't support. Warn and confirm before generating a
  // render.yaml that bills the api service, instead of a config that would
  // silently fail to deploy.
  if (database === 'sqlite') {
    console.warn(
      c.warning(
        "Render's free plan doesn't support persistent disks, which the " +
          '`sqlite` deploy option requires for its database file. The ' +
          `generated render.yaml will set the api service's plan to ` +
          `"${SQLITE_API_PLAN}" (a paid plan) instead of "free" so the ` +
          'disk can actually attach.\n\n' +
          'If you want to stay on the free plan, rerun this command with ' +
          '`--database postgresql` (a managed database, not a disk) or ' +
          '`--database none`.',
      ),
    )
    console.log()

    const { confirmed } = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: `Generate render.yaml with the api service on the "${SQLITE_API_PLAN}" plan?`,
    })

    if (!confirmed) {
      console.log('Aborting render setup.')
      return
    }

    console.log()
  }

  const tasks = new Listr(
    [
      {
        title: 'Adding render.yaml',
        task: async () => {
          const fileData = await getRenderYamlContent(database)
          const files: Record<string, string> = {}
          files[fileData.path] = fileData.content
          return writeFilesTask(files, { overwriteExisting: force })
        },
      },
      printSetupNotes(notes),
    ],
    { rendererOptions: { collapseSubtasks: false } },
  )

  try {
    await tasks.run()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    errorTelemetry(process.argv, message)
    console.error(c.error(message))
    // exitCode is a non-standard property Listr2 errors may carry
    const exitCode =
      e instanceof Error && 'exitCode' in e && typeof e.exitCode === 'number'
        ? e.exitCode
        : 1
    process.exit(exitCode)
  }
}
