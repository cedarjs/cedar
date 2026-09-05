import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { Listr } from 'listr2'
import { format } from 'prettier'
import { terminalLink } from 'termi-link'

import { colors as c } from '@cedarjs/cli-helpers/colors'
import { getPrettierOptions } from '@cedarjs/cli-helpers/fileHelpers'
import {
  addApiPackages,
  addWebPackages,
} from '@cedarjs/cli-helpers/installHelpers'
import { formatCedarCommand } from '@cedarjs/cli-helpers/packageManager/display'
import { addEnvVar } from '@cedarjs/cli-helpers/project'
import { getSchemaPath } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import { getPaths, transformTSToJS, writeFile } from '../../../lib/index.js'
import { isTypeScriptProject } from '../../../lib/project.js'
import { generateSecret } from '../../generate/secret/secret.js'
import { setupServerFileTasks } from '../server-file/serverFileHandler.js'

import { addUploadModel } from './schemaPrisma.js'
import { addUploadsPlugin, hasUploadsPlugin } from './serverFile.js'
import type { TargetChoice } from './uploads.js'

const UPPY_VERSION = '^6.0.0'

interface UploadsOptions {
  targets: TargetChoice[]
  force: boolean
}

const S3_IMPORTS = `import { S3Client } from '@aws-sdk/client-s3'

import { createS3Provider } from '@cedarjs/uploads/s3'
`

const S3_CLIENT = `
// Your own S3 client. It stays available for S3-specific work (lifecycle
// rules, CORS, and so on) alongside the storage target below.
export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
})
`

const TARGET_BLOCKS: Record<TargetChoice, string> = {
  fs: `  // Files uploaded through the api server and stored on local disk. Good for
  // development and single-server deploys.
  local: createFsProvider({
    uploadDir: path.join(getPaths().api.base, '.uploads'),
    serveBaseUrl: process.env.UPLOAD_SERVE_BASE_URL,
    signSecret: process.env.UPLOAD_TOKEN_SECRET,
  }),
`,
  db: `  // Small files stored inline in the Upload row (avatars, thumbnails).
  thumbnails: createDbProvider(),
`,
  s3: `  // Files uploaded straight from the browser to S3 with presigned URLs.
  files: createS3Provider({
    client: s3Client,
    bucket: process.env.S3_BUCKET_UPLOADS,
    keyPrefix: 'uploads/',
  }),
`,
}

const PROFILE_BLOCKS: Record<TargetChoice, string> = {
  fs: `  attachment: {
    target: 'local',
    allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
    maxFileSize: 25 * 1024 * 1024,
    maxFiles: 10,
  },
`,
  db: `  avatar: {
    target: 'thumbnails',
    allowedMimeTypes: ['image/png', 'image/jpeg'],
    maxFileSize: DB_MAX_FILE_SIZE,
    maxFiles: 1,
  },
`,
  s3: `  document: {
    target: 'files',
    allowedMimeTypes: ['application/pdf', 'image/*'],
    maxFileSize: 100 * 1024 * 1024,
    maxFiles: 5,
  },
`,
}

export const handler = async ({ targets, force }: UploadsOptions) => {
  const paths = getPaths()
  const projectIsTypescript = isTypeScriptProject()
  const ext = projectIsTypescript ? 'ts' : 'js'
  const wantsFs = targets.includes('fs')
  const wantsDb = targets.includes('db')
  const wantsS3 = targets.includes('s3')
  const wantsUppy = wantsFs || wantsS3

  const packageJson = await import(
    pathToFileURL(path.join(paths.base, 'package.json')).href,
    { with: { type: 'json' } }
  )
  const cedarVersion =
    packageJson.default.devDependencies['@cedarjs/core'] ?? 'latest'

  const serverFilePath = path.join(paths.api.src, `server.${ext}`)

  const writeTemplateFile = async (
    templateFile: string,
    outputPath: string,
    replacements: Record<string, string> = {},
  ) => {
    const templatePath = path.resolve(
      import.meta.dirname,
      'templates',
      templateFile,
    )
    let templateContent = fs.readFileSync(templatePath, 'utf-8')

    for (const [token, value] of Object.entries(replacements)) {
      templateContent = templateContent.replaceAll(token, value)
    }

    const content = projectIsTypescript
      ? templateContent
      : await transformTSToJS(outputPath, templateContent)

    return writeFile(outputPath, content, { overwriteExisting: force })
  }

  const apiPackages = [`@cedarjs/uploads@${cedarVersion}`]
  const webPackages = [`@cedarjs/uploads@${cedarVersion}`]

  if (wantsS3) {
    apiPackages.push('@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner')
  }

  if (wantsUppy) {
    webPackages.push(
      `@uppy/core@${UPPY_VERSION}`,
      `@uppy/react@${UPPY_VERSION}`,
      `@uppy/dashboard@${UPPY_VERSION}`,
    )
  }

  if (wantsFs) {
    webPackages.push(`@uppy/xhr-upload@${UPPY_VERSION}`)
  }

  if (wantsS3) {
    webPackages.push(`@uppy/aws-s3@${UPPY_VERSION}`)
  }

  const tasks = new Listr(
    [
      {
        ...addApiPackages(apiPackages),
        title: 'Adding @cedarjs/uploads to your api side...',
      },
      {
        ...addWebPackages(webPackages),
        title: 'Adding @cedarjs/uploads to your web side...',
      },
      {
        title: 'Adding the Upload model to schema.prisma...',
        task: async () => {
          const schemaPath = await getSchemaPath(paths.api.prismaConfig)
          const schema = fs.readFileSync(schemaPath, 'utf-8')

          fs.writeFileSync(schemaPath, addUploadModel(schema))
        },
      },
      {
        title: `Adding api/src/lib/uploads.${ext}...`,
        task: async () => {
          await writeTemplateFile(
            'srcLibUploads.ts.template',
            path.join(paths.api.lib, `uploads.${ext}`),
            {
              __S3_IMPORTS__: wantsS3 ? S3_IMPORTS : '',
              __S3_CLIENT__: wantsS3 ? S3_CLIENT : '',
              __FS_IMPORT__: wantsFs ? 'createFsProvider,' : '',
              __DB_IMPORT__: wantsDb ? 'createDbProvider,' : '',
              __DB_MAX_IMPORT__: wantsDb ? 'DB_MAX_FILE_SIZE,' : '',
              __PATH_IMPORT__: wantsFs
                ? "import path from 'node:path'\n\n"
                : '',
              __GET_PATHS_IMPORT__: wantsFs
                ? "import { getPaths } from '@cedarjs/project-config'\n"
                : '',
              __TARGETS__: targets.map((t) => TARGET_BLOCKS[t]).join('\n'),
              __PROFILES__: targets.map((t) => PROFILE_BLOCKS[t]).join('\n'),
            },
          )
        },
      },
      {
        title: 'Adding the uploads SDL and service...',
        task: async () => {
          await writeTemplateFile(
            'uploads.sdl.ts.template',
            path.join(paths.api.graphql, `uploads.sdl.${ext}`),
          )
          await writeTemplateFile(
            'uploads.ts.template',
            path.join(paths.api.services, 'uploads', `uploads.${ext}`),
          )
        },
      },
      {
        title: 'Adding the upload directives...',
        task: async () => {
          const directives = ['requireUploadToken', 'withSignedUrl']

          if (wantsDb) {
            directives.push('withDataUri')
          }

          for (const name of directives) {
            await writeTemplateFile(
              `${name}.ts.template`,
              path.join(paths.api.directives, name, `${name}.${ext}`),
            )
          }
        },
      },
      {
        title: 'Adding the server file...',
        task: (_ctx, task) =>
          task.newListr(setupServerFileTasks({ force: false })),
        skip: () =>
          fs.existsSync(serverFilePath)
            ? 'api/src/server already exists; skipping.'
            : false,
      },
      {
        title: 'Registering the upload plugin in api/src/server...',
        task: async (_ctx, task) => {
          const source = fs.readFileSync(serverFilePath, 'utf-8')

          if (hasUploadsPlugin(source)) {
            task.skip('The upload plugin is already registered; skipping.')
            return
          }

          try {
            fs.writeFileSync(serverFilePath, addUploadsPlugin(source))
          } catch {
            throw new Error(
              `Could not find \`await server.start()\` in ${path.relative(
                paths.base,
                serverFilePath,
              )}. Register the plugin by hand before the server starts:\n\n` +
                "  import { cedarUploadsPlugin } from '@cedarjs/uploads'\n" +
                "  import { db } from 'src/lib/db'\n" +
                "  import { targets } from 'src/lib/uploads'\n\n" +
                '  await server.register(cedarUploadsPlugin, {\n' +
                '    tokenSecret: process.env.UPLOAD_TOKEN_SECRET,\n' +
                '    targets,\n' +
                '    db,\n' +
                '  })\n',
            )
          }
        },
      },
      {
        title: 'Adding environment variables to .env...',
        task: () => {
          addEnvVar(
            'UPLOAD_TOKEN_SECRET',
            generateSecret(),
            'Signs upload tokens and file-serving URLs. Keep it secret and use a different value per environment.',
          )

          if (wantsFs) {
            addEnvVar(
              'UPLOAD_SERVE_BASE_URL',
              'http://localhost:8911',
              'Origin the api server is reachable at, used to build signed URLs for locally stored files.',
            )
          }

          if (wantsS3) {
            addEnvVar(
              'AWS_REGION',
              'us-east-1',
              'Region of the uploads bucket.',
            )
            addEnvVar('AWS_ACCESS_KEY_ID', 'replace-me', '')
            addEnvVar('AWS_SECRET_ACCESS_KEY', 'replace-me', '')
            addEnvVar(
              'S3_BUCKET_UPLOADS',
              'replace-me',
              'Bucket direct uploads land in.',
            )
          }
        },
      },
      {
        title: 'Prettifying changed files',
        task: async (_ctx, task) => {
          const prettifyPaths = [
            serverFilePath,
            path.join(paths.api.lib, `uploads.${ext}`),
            path.join(paths.api.graphql, `uploads.sdl.${ext}`),
            path.join(paths.api.services, 'uploads', `uploads.${ext}`),
          ]

          for (const prettifyPath of prettifyPaths) {
            try {
              if (!fs.existsSync(prettifyPath)) {
                continue
              }

              const source = fs.readFileSync(prettifyPath, 'utf-8')
              const prettierOptions = await getPrettierOptions()
              const prettified = await format(source, {
                ...prettierOptions,
                parser: 'babel-ts',
              })

              fs.writeFileSync(prettifyPath, prettified, 'utf-8')
            } catch {
              task.output =
                "Couldn't prettify the changes. Please reformat the files manually if needed."
            }
          }
        },
      },
      {
        title: 'One more thing...',
        task: (_ctx, task) => {
          const migrate = c.highlight(
            formatCedarCommand(['prisma', 'migrate', 'dev']),
          )
          const types = c.highlight(formatCedarCommand(['generate', 'types']))

          task.title = `One more thing...

          ${c.success('Uploads configured!')}

          Next steps:

            1. Apply the schema change: ${migrate}
            2. Regenerate types: ${types}
            3. Review the storage targets and upload profiles in api/src/lib/uploads.${ext}${
              wantsS3
                ? '\n            4. Fill in the AWS_* and S3_BUCKET_UPLOADS values in .env'
                : ''
            }

          To bind upload tokens to the logged-in user, pass
          \`authenticate: createUploadAuthenticator({ authDecoder, getCurrentUser })\`
          to the plugin in api/src/server.${ext}.

          Schedule cleanupStaleUploads() from a recurring job to sweep uploads
          that never completed.

          Check out the docs for more info:
          ${terminalLink('', 'https://cedarjs.com/docs/uploads')}
        `
        },
      },
    ],
    {
      rendererOptions: { collapseSubtasks: false },
    },
  )

  try {
    await tasks.run()
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    const exitCode =
      e instanceof Error && 'exitCode' in e && typeof e.exitCode === 'number'
        ? e.exitCode
        : 1
    errorTelemetry(process.argv, message)
    console.error(c.error(message))
    process.exit(exitCode)
  }
}
