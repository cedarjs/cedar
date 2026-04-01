import fs from 'node:fs'
import path from 'node:path'

import untildify from 'untildify'

import { RedwoodTUI, ReactiveTUIContent, RedwoodStyling } from '@cedarjs/tui'

import { handleNewDirectoryNamePreference } from './handle-args.js'
import type { PackageManager } from './handle-args.js'
import { getCedarCommandPrefix, getInstallCommand } from './package-manager.js'
import { UID, shutdownTelemetry, recordErrorViaTelemetry } from './telemetry.js'

const tui = new RedwoodTUI()
interface CreateProjectFilesOptions {
  templateDir: string
  templatesDir: string
  overwrite: boolean
  packageManager: PackageManager
  useEsm: boolean
  database: string | null
}

export async function createProjectFiles(
  appDir: string,
  {
    templateDir,
    templatesDir,
    overwrite,
    packageManager,
    useEsm,
    database,
  }: CreateProjectFilesOptions,
) {
  let newAppDir = appDir
  const overlayDir = path.join(
    templatesDir,
    'overlays',
    useEsm ? 'esm' : 'cjs',
    packageManager,
  )

  const tuiContent = new ReactiveTUIContent({
    mode: 'text',
    content: 'Creating project files',
    spinner: {
      enabled: true,
    },
  })
  tui.startReactive(tuiContent)

  newAppDir = await doesDirectoryAlreadyExist(newAppDir, { overwrite })

  // Ensure the new app directory exists
  fs.mkdirSync(path.dirname(newAppDir), { recursive: true })

  // Copy the template files to the new app directory
  // Have to use fs.promises.cp here because of a bug in yarn
  // See https://github.com/yarnpkg/berry/issues/6488
  await fs.promises.cp(templateDir, newAppDir, {
    recursive: true,
    force: overwrite,
  })
  await fs.promises.cp(overlayDir, newAppDir, { recursive: true, force: true })

  // Apply database overlay if pglite is selected
  if (database === 'pglite') {
    // Remove the template's prisma config since the overlay provides its own
    const templatePrismaConfig = path.join(
      newAppDir,
      'api',
      'prisma.config.cjs',
    )
    try {
      await fs.promises.unlink(templatePrismaConfig)
    } catch {
      // Ignore if the file doesn't exist
    }

    const dbOverlayDir = path.join(
      templatesDir,
      '..',
      'database-overlays',
      'pglite',
    )
    await fs.promises.cp(dbOverlayDir, newAppDir, {
      recursive: true,
      force: true,
    })
  }

  // .gitignore is renamed here to force file inclusion during publishing
  fs.renameSync(
    path.join(newAppDir, 'gitignore.template'),
    path.join(newAppDir, '.gitignore'),
  )

  await replacePlaceholders(newAppDir, packageManager)

  // Write the uid
  fs.mkdirSync(path.join(newAppDir, '.cedar'), { recursive: true })
  fs.writeFileSync(path.join(newAppDir, '.cedar', 'telemetry.txt'), UID)

  const filesCreated = `${RedwoodStyling.green('✔')} Project files created`
  tuiContent.update({ spinner: { enabled: false }, content: filesCreated })
  tui.stopReactive()

  return newAppDir
}

/** String replace of placeholders in template files */
async function replacePlaceholders(
  dir: string,
  packageManager: PackageManager,
) {
  const installCommand = getInstallCommand(packageManager)
  const cedarCommand = getCedarCommandPrefix(packageManager)

  const replacements: Record<string, string> = {
    '{{PM}}': packageManager,
    '{{PM_INSTALL}}': installCommand,
    '{{CEDAR_CLI}}': cedarCommand,
  }

  const patterns = [
    '**/*.{json,md,js,ts,yml,yaml}',
    '**/.*/**/*.{json,md,js,ts,yml,yaml}',
  ]

  for (const pattern of patterns) {
    for await (const file of fs.promises.glob(pattern, { cwd: dir })) {
      const fullPath = path.join(dir, file)
      let content = await fs.promises.readFile(fullPath, 'utf-8')

      for (const [placeholder, value] of Object.entries(replacements)) {
        content = content.replaceAll(placeholder, value)
      }

      await fs.promises.writeFile(fullPath, content, 'utf-8')
    }
  }
}

async function doesDirectoryAlreadyExist(
  appDir: string,
  {
    overwrite,
    suppressWarning,
  }: { overwrite: boolean; suppressWarning?: boolean },
) {
  let newAppDir = appDir

  // Check if the new app directory already exists
  if (fs.existsSync(newAppDir) && !overwrite) {
    // Check if the directory contains files and show an error if it does
    if (fs.readdirSync(newAppDir).length > 0) {
      const styledAppDir = RedwoodStyling.info(newAppDir)

      if (!suppressWarning) {
        tui.stopReactive(true)
        tui.displayWarning(
          'Project directory already contains files',
          [`'${styledAppDir}' already exists and is not empty`].join('\n'),
        )
      }

      try {
        const response = await tui.prompt<{
          projectDirectoryAlreadyExists: string
        }>({
          type: 'select',
          name: 'projectDirectoryAlreadyExists',
          message: 'How would you like to proceed?',
          choices: [
            'Quit install',
            `Overwrite files in '${styledAppDir}' and continue install`,
            'Specify a different directory',
          ],
          initial: 0,
        })

        // overwrite the existing files
        if (
          response.projectDirectoryAlreadyExists ===
          `Overwrite files in '${styledAppDir}' and continue install`
        ) {
          // blow away the existing directory and create a new one
          await fs.promises.rm(newAppDir, { recursive: true, force: true })
        } // specify a different directory
        else if (
          response.projectDirectoryAlreadyExists ===
          'Specify a different directory'
        ) {
          const newDirectoryName = await handleNewDirectoryNamePreference()

          if (/^~\w/.test(newDirectoryName)) {
            tui.stopReactive(true)
            tui.displayError(
              'The `~username` syntax is not supported here',
              'Please use the full path or specify the target directory on the command line.',
            )

            // Calling doesDirectoryAlreadyExist again with the same old
            // appDir as a way to prompt the user for a new directory name
            // after displaying the error above
            newAppDir = await doesDirectoryAlreadyExist(appDir, {
              overwrite,
              suppressWarning: true,
            })
          } else {
            newAppDir = path.resolve(process.cwd(), untildify(newDirectoryName))
          }

          // check to see if the new directory exists
          newAppDir = await doesDirectoryAlreadyExist(newAppDir, { overwrite })
        } // Quit Install and Throw and Error
        else if (response.projectDirectoryAlreadyExists === 'Quit install') {
          // quit and throw an error
          recordErrorViaTelemetry(
            'User quit after directory already exists error',
          )
          await shutdownTelemetry()
          process.exit(1)
        }
        // overwrite the existing files
      } catch {
        recordErrorViaTelemetry(
          `User cancelled install after directory already exists error`,
        )
        await shutdownTelemetry()
        process.exit(1)
      }
    }
  }

  return newAppDir
}
