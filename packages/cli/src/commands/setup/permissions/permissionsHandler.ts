import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { Listr } from 'listr2'
import { format } from 'prettier'
import { terminalLink } from 'termi-link'

import { colors as c } from '@cedarjs/cli-helpers/colors'
import { getPrettierOptions } from '@cedarjs/cli-helpers/fileHelpers'
import { addApiPackages } from '@cedarjs/cli-helpers/installHelpers'
import { formatCedarCommand } from '@cedarjs/cli-helpers/packageManager/display'
import { runBinSync } from '@cedarjs/cli-helpers/packageManager/exec'
import { getSchemaPath } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import { getPaths, transformTSToJS, writeFile } from '../../../lib/index.js'
import { isTypeScriptProject } from '../../../lib/project.js'
import { runTransform } from '../../../lib/runTransform.js'
import { hasWebAuthFile } from '../tenancy/preflight.js'

import {
  addPermissionsPackageTasks,
  permissionsPackageName,
} from './permissionsPackage.js'
import type { PermissionsPackageCtx } from './permissionsPackage.js'
import { authNotSetUpMessage, hasTenancyMessage } from './preflight.js'
import {
  findRoles,
  permissionsIndexSource,
  userModelHasRoles,
} from './roles.js'

const AUTH_SNIPPET = `
  import { withPermissions } from 'src/lib/permissions'

  export const getCurrentUser = async (session) => {
    return withPermissions(await db.user.findUnique({
      where: { id: session.id },
      select: { id: true, roles: true },
    }))
  }`

/** The template files, by their name in ./templates */
const templatePath = (templateFile: string) =>
  path.resolve(import.meta.dirname, 'templates', templateFile)

function dependsOnTenancy(packageJsonPath: string) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

    return (
      !!packageJson.dependencies?.['@cedarjs/tenancy'] ||
      !!packageJson.devDependencies?.['@cedarjs/tenancy']
    )
  } catch {
    return false
  }
}

export const handler = async ({ force }: { force: boolean }) => {
  const paths = getPaths()

  // Checked before anything is written, including with `--force`
  if (!hasWebAuthFile(paths.web.src)) {
    console.error(c.error(authNotSetUpMessage()))
    process.exit(1)
  }

  if (dependsOnTenancy(path.join(paths.api.base, 'package.json'))) {
    console.error(c.error(hasTenancyMessage()))
    process.exit(1)
  }

  const projectIsTypescript = isTypeScriptProject()
  const ext = projectIsTypescript ? 'ts' : 'js'

  const packageJson = await import(
    pathToFileURL(path.join(paths.base, 'package.json')).href,
    { with: { type: 'json' } }
  )
  const cedarVersion =
    packageJson.default.devDependencies['@cedarjs/core'] ?? 'latest'

  const authPath = path.join(paths.api.lib, `auth.${ext}`)
  // Before anything is written, so they're the app's own
  const roles = findRoles([paths.api.src, paths.web.src])

  // Everything this command writes from a template, to format and lint
  const writtenFiles: string[] = []
  // Template files that were already there, so weren't written
  const keptFiles: string[] = []

  const writeTemplateFile = async (
    templateFile: string,
    outputPath: string,
  ) => {
    const templateContent = fs
      .readFileSync(templatePath(templateFile), 'utf-8')
      .replaceAll('__PERMISSIONS_PACKAGE__', permissionsPackageName())

    // From an earlier run, or the app's own: kept unless --force
    if (fs.existsSync(outputPath) && !force) {
      keptFiles.push(outputPath)
      return
    }

    const content = projectIsTypescript
      ? templateContent
      : await transformTSToJS(outputPath, templateContent)

    writtenFiles.push(outputPath)

    return writeFile(outputPath, content, { overwriteExisting: force })
  }

  const tasks = new Listr<PermissionsPackageCtx>(
    [
      {
        ...addApiPackages([`@cedarjs/permissions@${cedarVersion}`]),
        title: 'Adding @cedarjs/permissions to your api side...',
      },
      {
        title: 'Adding the permissions package...',
        task: () =>
          addPermissionsPackageTasks({
            cedarVersion,
            indexSource: permissionsIndexSource(
              fs.readFileSync(
                templatePath('permissionsPackage.index.ts.template'),
                'utf-8',
              ),
              roles,
            ),
            force,
          }),
      },
      {
        title:
          'Adding permission checks and the requirePermission directive...',
        task: async () => {
          await writeTemplateFile(
            'permissions.ts.template',
            path.join(paths.api.lib, `permissions.${ext}`),
          )

          const directiveDir = path.join(
            paths.api.directives,
            'requirePermission',
          )

          await writeTemplateFile(
            'requirePermission.ts.template',
            path.join(directiveDir, `requirePermission.${ext}`),
          )
          await writeTemplateFile(
            'requirePermission.test.ts.template',
            path.join(directiveDir, `requirePermission.test.${ext}`),
          )
        },
      },
      {
        title: 'Adding the user’s permissions to getCurrentUser...',
        task: async (_ctx, task) => {
          if (!fs.existsSync(authPath)) {
            task.skip('No api/src/lib/auth file found; skipping.')
            return
          }

          let userHasRoles = false

          try {
            userHasRoles = userModelHasRoles(
              fs.readFileSync(
                await getSchemaPath(paths.api.prismaConfig),
                'utf-8',
              ),
            )
          } catch {
            // No Prisma schema, so nothing to select roles from
          }

          const transformResult = await runTransform({
            transformPath: path.join(import.meta.dirname, 'authCodemod.js'),
            targetPaths: [authPath],
            options: { userHasRoles },
          })

          if (transformResult.error) {
            task.output = `Could not update api/src/lib/auth automatically. Please add this by hand:\n${AUTH_SNIPPET}`
          }
        },
      },
      {
        title: 'Formatting and linting changed files...',
        task: async (_ctx, task) => {
          const changedFiles = [...writtenFiles, authPath].filter((file) =>
            fs.existsSync(file),
          )

          const prettierOptions = await getPrettierOptions()

          for (const file of changedFiles) {
            try {
              const source = fs.readFileSync(file, 'utf-8')
              const formatted = await format(source, {
                ...prettierOptions,
                parser: 'babel-ts',
              })

              fs.writeFileSync(file, formatted, 'utf-8')
            } catch {
              task.output =
                "Couldn't prettify the changes. Please reformat the files manually if needed."
            }
          }

          // Sorts the imports the way the app's lint rules want them
          try {
            runBinSync('eslint', ['--fix', ...changedFiles], {
              cwd: paths.base,
            })
          } catch {
            task.output = `Some of the changed files still have lint errors. Run ${c.highlight(
              formatCedarCommand(['lint']),
            )} to see them.`
          }
        },
      },
      {
        title: 'Next steps...',
        task: (ctx, task) => {
          const rolesText =
            roles.length > 0
              ? `It has an entry, with no permissions yet, for each role
             your role lists name: ${roles.map((role) => c.highlight(role)).join(', ')}.`
              : `It has an example map, as no role lists name a role.`

          task.title = `Next steps...

          ${c.success('\nPermissions configured!\n')}
          1. Your permissions, and what each role may do, are in
             ${c.highlight('packages/permissions')}, shared by the api and web sides${
               ctx.packagesWorkspaceTurnedOn
                 ? ` (this
             turned on ${c.highlight('experimental.packagesWorkspace')} in cedar.toml)`
                 : ''
             }.
             ${rolesText}
             A role is a bundle of permissions: list what each one may do.
          2. A user may do what any of their roles, in ${c.highlight('currentUser.roles')},
             may do, so ${c.highlight('getCurrentUser')} returns ${c.highlight('roles')}: this selects
             them when your ${c.highlight('User')} model has a ${c.highlight('roles')} field. Without one,
             return the user's roles from where they're kept. It returns the
             user through ${c.highlight('withPermissions')}, which adds
             ${c.highlight('currentUser.permissions')} for the web.
          3. Guard fields with ${c.highlight('@requirePermission(permission: "...")')}, and
             services with ${c.highlight("requirePermission('...')")} from src/lib/permissions.
             A field with a ${c.highlight('roles')} list checks those roles; move each to a
             permission that names what it allows, so a new role can do
             only what its entry in the map says.
          4. On the web, check permissions with ${c.highlight('useAuth().hasPermission()')}, and
             guard routes with ${c.highlight('<PrivateSet permission="...">')}. A user without
             it is sent to ${c.highlight('unauthorized')}. ${c.highlight(formatCedarCommand(['generate', 'types']))}
             types the names.
          5. In tests, ${c.highlight("mockCurrentUser({ roles: ['admin'] })")} gives the user
             the permissions the map gives ${c.highlight('admin')}.
${
  keptFiles.length > 0
    ? `
          Kept these existing files rather than overwriting them (run with
          ${c.highlight('--force')} to overwrite):
${keptFiles.map((file) => `            ${path.relative(paths.base, file)}`).join('\n')}
`
    : ''
}
          Check out the docs for more info:
          ${terminalLink('', 'https://cedarjs.com/docs/permissions')}

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
