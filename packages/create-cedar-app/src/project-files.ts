import fs from 'node:fs'
import path from 'node:path'

import untildify from 'untildify'

import { ReactiveTUIContent, RedwoodStyling } from '@cedarjs/tui'

import { handleNewDirectoryNamePreference } from './handle-args.js'
import type { PackageManager } from './handle-args.js'
import {
  getCedarCommandPrefix,
  getDlx,
  getInstallCommand,
} from './package-manager.js'
import { UID, shutdownTelemetry, recordErrorViaTelemetry } from './telemetry.js'
import { tui } from './tui.js'

interface CreateProjectFilesOptions {
  templateDir: string
  templatesDir: string
  overwrite: boolean
  packageManager: PackageManager
  useEsm: boolean
  database: string
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

  let databaseUrl = ''
  let directDatabaseUrl = ''
  let neonClaimExpiry = ''
  let neonClaimUrl = ''

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
  } else if (database === 'neon-postgres') {
    const dbOverlayDir = path.join(
      templatesDir,
      '..',
      'database-overlays',
      'neon-postgres',
    )
    await fs.promises.cp(dbOverlayDir, newAppDir, {
      recursive: true,
      force: true,
    })

    // curl -X POST https://neon.new/api/v1/database \
    //   -H 'Content-Type: application/json' \
    //   -d '{"ref": "your-app-name"}'
    //
    // Response: {
    //   "id": "01abc123-def4-5678-9abc-def012345678",
    //   "status": "UNCLAIMED",
    //   "neon_project_id": "cool-breeze-12345678",
    //   "connection_string": "postgresql://neondb_owner:npg_xxxx@ep-cool-breeze-pooler.c-2...",
    //   "claim_url": "https://neon.new/claim/01abc123-def4-5678-9abc-def012345678",
    //   "expires_at": "2026-02-01T12:00:00.000Z",
    //   "created_at": "2026-01-29T12:00:00.000Z",
    //   "updated_at": "2026-01-29T12:00:00.000Z"
    // }
    try {
      const res = await fetch('https://neon.new/api/v1/database', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'cedarjs' }),
      })

      if (!res.ok) {
        // Throw error that we'll catch below
        throw new Error(`Neon API returned ${res.status} ${res.statusText}`)
      }

      const data = await res.json()

      if (!data.connection_string || !data.expires_at || !data.claim_url) {
        throw new Error(
          'Neon API returned an invalid response\n\n' +
            JSON.stringify(data, null, 2),
        )
      }

      // https://neon.com/docs/reference/glossary#pooled-connection-string
      databaseUrl = data.connection_string
      directDatabaseUrl = data.connection_string.replace('-pooler.', '.')
      neonClaimExpiry = new Date(data.expires_at).toUTCString()
      neonClaimUrl = data.claim_url

      const d = new Date(data.expires_at)
      const yy = d.getFullYear()
      const mm = `0${d.getMonth() + 1}`.slice(-2)
      const dd = `0${d.getDate()}`.slice(-2)
      const expiresAt = `${yy}-${mm}-${dd}`

      tui.drawText('  Database created successfully')
      tui.drawText('  Claim your Neon database by visiting the url below:')
      tui.drawText('    ' + neonClaimUrl)
      tui.drawText(
        `  You can use the database until ${expiresAt} without claiming it`,
      )
      tui.drawText('')
    } catch (e) {
      databaseUrl = ''

      const errorMessage = e instanceof Error ? e.message : String(e)
      tui.displayWarning(
        'Could not create database',
        `Run \`${getDlx(packageManager)} neon-new --yes\` to manually create ` +
          `one.\n\n${errorMessage}`,
      )
    }
  }

  // .gitignore is renamed here to force file inclusion during publishing
  fs.renameSync(
    path.join(newAppDir, 'gitignore.template'),
    path.join(newAppDir, '.gitignore'),
  )

  await replacePlaceholders(newAppDir, {
    packageManager,
    databaseUrl,
    directDatabaseUrl,
    neonClaimExpiry,
    neonClaimUrl,
  })

  // Write the uid
  fs.mkdirSync(path.join(newAppDir, '.cedar'), { recursive: true })
  fs.writeFileSync(path.join(newAppDir, '.cedar', 'telemetry.txt'), UID)

  const filesCreated = `${RedwoodStyling.green('✔')} Project files created`
  tuiContent.update({ spinner: { enabled: false }, content: filesCreated })
  tui.stopReactive()

  return newAppDir
}

interface ReplacementValues {
  packageManager: PackageManager
  databaseUrl: string
  directDatabaseUrl: string
  neonClaimExpiry: string
  neonClaimUrl: string
}

/** String replace of placeholders in template files */
async function replacePlaceholders(dir: string, values: ReplacementValues) {
  const installCommand = getInstallCommand(values.packageManager)
  const cedarCommand = getCedarCommandPrefix(values.packageManager)
  // TODO: Figure out how to make this dynamic, but still have it working with
  // yarn dlx, npx etc
  const prismaVersion = '7.6.0'

  const replacements: Record<string, string | undefined> = {
    '{{PM}}': values.packageManager,
    '{{PM_INSTALL}}': installCommand,
    '{{CEDAR_CLI}}': cedarCommand,
    '{{PRISMA_VERSION}}': prismaVersion,
    '{{DATABASE_URL}}': values.databaseUrl,
    '{{DIRECT_DATABASE_URL}}': values.directDatabaseUrl,
    '{{NEON_CLAIM_EXPIRY}}': values.neonClaimExpiry,
    '{{NEON_CLAIM_URL}}': values.neonClaimUrl,
  }

  const patterns = [
    '**/*.{json,md,js,ts,yml,yaml}',
    '**/.*/**/*.{json,md,js,ts,yml,yaml}',
    '**/.env*',
  ]

  for (const pattern of patterns) {
    for await (const file of fs.promises.glob(pattern, { cwd: dir })) {
      const fullPath = path.join(dir, file)
      let content = await fs.promises.readFile(fullPath, 'utf-8')

      for (const [placeholder, value] of Object.entries(replacements)) {
        if (value !== undefined) {
          content = content.replaceAll(placeholder, value)
        }
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
