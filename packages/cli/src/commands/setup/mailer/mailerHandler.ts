import fs from 'node:fs'
import path from 'node:path'

import { Listr } from 'listr2'

import { addApiPackages, colors as c } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import { getPaths, transformTSToJS, writeFile } from '../../../lib/index.js'
import { isTypeScriptProject } from '../../../lib/project.js'

interface PkgJson {
  devDependencies?: Record<string, string>
}

export const handler = async ({
  force,
  skipExamples,
}: {
  force: boolean
  skipExamples: boolean
}) => {
  const projectIsTypescript = isTypeScriptProject()
  const pkgJsonPath = path.join(getPaths().base, 'package.json')
  const pkgJson: PkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
  const cedarVersion = pkgJson.devDependencies?.['@cedarjs/core'] ?? 'latest'

  const extension = projectIsTypescript ? 'ts' : 'js'

  const tasks = new Listr(
    [
      {
        title: `Adding api/src/lib/mailer.${extension}...`,
        task: async () => {
          const templatePath = path.resolve(
            import.meta.dirname,
            'templates',
            'mailer.ts.template',
          )
          const templateContent = fs.readFileSync(templatePath, {
            encoding: 'utf8',
            flag: 'r',
          })

          const mailerPath = path.join(
            getPaths().api.lib,
            `mailer.${extension}`,
          )
          const mailerContent = projectIsTypescript
            ? templateContent
            : await transformTSToJS(mailerPath, templateContent)

          return writeFile(mailerPath, mailerContent, {
            overwriteExisting: force,
          })
        },
      },
      {
        title: 'Adding api/src/mail directory...',
        task: () => {
          const mailDir = path.join(getPaths().api.mail)
          if (!fs.existsSync(mailDir)) {
            fs.mkdirSync(mailDir)
          }
        },
      },
      {
        title: `Adding example ReactEmail mail template`,
        skip: () => skipExamples,
        task: async () => {
          const templatePath = path.resolve(
            import.meta.dirname,
            'templates',
            're-example.tsx.template',
          )
          const templateContent = fs.readFileSync(templatePath, {
            encoding: 'utf8',
            flag: 'r',
          })

          const exampleTemplatePath = path.join(
            getPaths().api.mail,
            'Example',
            `Example.${projectIsTypescript ? 'tsx' : 'jsx'}`,
          )
          const exampleTemplateContent = projectIsTypescript
            ? templateContent
            : await transformTSToJS(exampleTemplatePath, templateContent)

          return writeFile(exampleTemplatePath, exampleTemplateContent, {
            overwriteExisting: force,
          })
        },
      },
      {
        // Add production dependencies
        ...addApiPackages([
          `@cedarjs/mailer-core@${cedarVersion}`,
          `@cedarjs/mailer-handler-nodemailer@${cedarVersion}`,
          `@cedarjs/mailer-renderer-react-email@${cedarVersion}`,
          `@react-email/components`, // NOTE: Unpinned dependency here
        ]),
        title: 'Adding production dependencies to your api side...',
      },
      {
        // Add development dependencies
        ...addApiPackages([
          '-D',
          `@cedarjs/mailer-handler-in-memory@${cedarVersion}`,
          `@cedarjs/mailer-handler-studio@${cedarVersion}`,
        ]),
        title: 'Adding development dependencies to your api side...',
      },
    ],
    {
      rendererOptions: { collapseSubtasks: false },
    },
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
