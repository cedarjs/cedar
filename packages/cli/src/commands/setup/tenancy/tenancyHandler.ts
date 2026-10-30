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
import {
  runBinSync,
  runTransitiveBin,
} from '@cedarjs/cli-helpers/packageManager/exec'
import { getDataMigrationsPath, getSchemaPath } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import { getPaths, transformTSToJS, writeFile } from '../../../lib/index.js'
import { isTypeScriptProject } from '../../../lib/project.js'
import { runTransform } from '../../../lib/runTransform.js'

import { TENANCY_AUTH_EXPORT } from './authCodemod.js'
import {
  addPermissionsPackageTasks,
  permissionsPackageName,
} from './permissionsPackage.js'
import type { PermissionsPackageCtx } from './permissionsPackage.js'
import {
  authNotSetUpMessage,
  hasWebAuthFile,
  noUserModelMessage,
} from './preflight.js'
import {
  addRequiredUserFields,
  editSchema,
  hasModel,
  MEMBERSHIP_MODEL,
  ORGANIZATION_MODEL,
  requiredUserFields,
} from './schemaPrisma.js'
import type { EditSchemaResult, ModelsExistOutcome } from './schemaPrisma.js'

const DEFAULT_TENANT_FIELD = 'organizationId'

const AUTH_SNIPPET = `
  import { createTenancyAuth } from '@cedarjs/tenancy'

  import { withPermissions } from 'src/lib/permissions'

  export const getCurrentUser = async (session) => {
    return withPermissions(await db.user.findUnique({
      where: { id: session.id },
      select: {
        // ...your existing fields...
        memberships: {
          select: {
            id: true,
            organizationId: true,
            role: true,
            organization: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    }))
  }

  // In place of your hasRole and requireAuth
  ${TENANCY_AUTH_EXPORT}`

const SIGNUP_SNIPPET = `
  handler: async ({ username, hashedPassword, salt, userAttributes }) => {
    const user = await db.user.create({
      data: { email: username, hashedPassword, salt },
    })

    await ensureDefaultOrganization({
      currentUser: user,
      invitationToken: userAttributes?.invitationToken,
    })

    return user
  },
`

interface TenancyOptions {
  tenantField: string
  force: boolean
}

interface TenancyCtx extends PermissionsPackageCtx {
  /** Set once the schema-editing task runs; read by the "Next steps" task. */
  modelsExistOutcome?: ModelsExistOutcome
  /**
   * Set when `tenancy` couldn't be passed to the app's `<Router>`, so
   * the next steps say to do it by hand
   */
  routerNeedsTenancy?: boolean
}

export const handler = async ({ tenantField, force }: TenancyOptions) => {
  const paths = getPaths()

  // Checked before anything is written, including with `--force`: without
  // auth and a `User` model there is nothing for memberships to hang off, so
  // every file this command writes would be wrong.
  if (!hasWebAuthFile(paths.web.src)) {
    console.error(c.error(authNotSetUpMessage()))
    process.exit(1)
  }

  const preflightSchemaPath = await getSchemaPath(paths.api.prismaConfig)

  if (!hasModel(fs.readFileSync(preflightSchemaPath, 'utf-8'), 'User')) {
    console.error(
      c.error(
        noUserModelMessage(path.relative(paths.base, preflightSchemaPath)),
      ),
    )
    process.exit(1)
  }

  const projectIsTypescript = isTypeScriptProject()
  const ext = projectIsTypescript ? 'ts' : 'js'
  const componentExt = projectIsTypescript ? 'tsx' : 'jsx'

  const packageJson = await import(
    pathToFileURL(path.join(paths.base, 'package.json')).href,
    { with: { type: 'json' } }
  )
  const cedarVersion =
    packageJson.default.devDependencies['@cedarjs/core'] ?? 'latest'

  const authPath = path.join(paths.api.lib, `auth.${ext}`)
  const graphqlPath = path.join(paths.api.functions, `graphql.${ext}`)
  const functionsAuthPath = path.join(paths.api.functions, `auth.${ext}`)
  const isDbAuthProject =
    fs.existsSync(functionsAuthPath) &&
    fs.readFileSync(functionsAuthPath, 'utf-8').includes('DbAuthHandler')

  // Everything this command writes from a template, to format and lint
  const writtenFiles: string[] = []
  // Template files that were already there, so weren't written
  const keptFiles: string[] = []

  const writeTemplateFile = async (
    templateFile: string,
    outputPath: string,
    replacements: Record<string, string> = {},
    transform: (content: string) => string = (content) => content,
  ) => {
    const dirname = import.meta.dirname
    const templatePath = path.resolve(dirname, 'templates', templateFile)
    let templateContent = fs.readFileSync(templatePath, 'utf-8')

    for (const [token, value] of Object.entries(replacements)) {
      templateContent = templateContent.replaceAll(token, value)
    }

    templateContent = transform(templateContent)

    const content = projectIsTypescript
      ? templateContent
      : await transformTSToJS(outputPath, templateContent)

    // From an earlier run, or the app's own: kept unless --force
    if (fs.existsSync(outputPath) && !force) {
      keptFiles.push(outputPath)
      return
    }

    writtenFiles.push(outputPath)

    return writeFile(outputPath, content, { overwriteExisting: force })
  }

  const tasks = new Listr<TenancyCtx>(
    [
      {
        ...addApiPackages([`@cedarjs/tenancy@${cedarVersion}`]),
        title: 'Adding @cedarjs/tenancy to your api side...',
      },
      {
        ...addWebPackages([`@cedarjs/tenancy@${cedarVersion}`]),
        title: 'Adding @cedarjs/tenancy to your web side...',
      },
      {
        title: 'Adding Organization and Membership models to schema.prisma...',
        task: async (ctx, task) => {
          const schemaPath = await getSchemaPath(paths.api.prismaConfig)
          const schema = fs.readFileSync(schemaPath, 'utf-8')

          let editResult: EditSchemaResult

          try {
            editResult = editSchema(schema, { force })
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e)

            if (message === 'CEDAR_TENANCY_ERR_NO_USER_MODEL') {
              const authSetup = formatCedarCommand(['setup', 'auth', 'dbAuth'])
              const tenancySetup = formatCedarCommand(['setup', 'tenancy'])

              throw new Error(
                'No `User` model found in schema.prisma. Set up ' +
                  `authentication first (e.g. \`${authSetup}\`) before ` +
                  `running \`${tenancySetup}\`.`,
              )
            }

            throw e
          }

          ctx.modelsExistOutcome = editResult.outcome

          fs.writeFileSync(schemaPath, editResult.schema)

          // Default path when Organization/Membership already exist,
          // customized, and --force was not passed: leave them as-is and
          // print the canonical shape, the same way the auth/signup codemods
          // fall back to printing AUTH_SNIPPET/SIGNUP_SNIPPET when they can't
          // transform a file safely. The rest of setup still runs.
          if (editResult.outcome === 'skipped') {
            task.output = `\`Organization\` and/or \`Membership\` models already exist in schema.prisma and were left as-is. Add these fields and relations by hand so tenancy can use them:\n\n${ORGANIZATION_MODEL}\n\n${MEMBERSHIP_MODEL}\n\nRe-run with --force to have this command append its own versions beside them instead, so you can diff and merge rather than retype.`
            return
          }

          // Adds the `memberships` back-relation on `User`: appending
          // `Organization` and `Membership`, both of which declare a relation
          // to `User`, is enough for Prisma's formatter to add the matching
          // field. Not best-effort -- the generated `getCurrentUser` selects
          // `memberships`, so a schema without it breaks at runtime. When
          // `--force` appended this command's models beside customized ones
          // of the same name (`outcome === 'forced'`), the schema is already
          // known to be invalid Prisma; formatting is attempted anyway, but a
          // failure here is not fatal -- the user asked for this, and "Next
          // steps" tells them how to resolve it.
          try {
            await runTransitiveBin(
              'prisma',
              ['format', '--config', paths.api.prismaConfig],
              { cwd: paths.base },
            )
          } catch {
            if (editResult.outcome === 'forced') {
              task.output =
                '`prisma format` failed because the appended Organization/Membership clash with your existing ones, as requested by --force. Continuing with the rest of the setup; see "Next steps" for how to merge them.'
              return
            }

            throw new Error(
              '`prisma format` failed, so the `memberships` relation was not added to the `User` model. Add it by hand: `memberships Membership[]` as the last field of `model User { ... }`, then re-run this command.',
            )
          }

          // The field name comes from the formatter, not from us. A rename
          // would break loudly at type-check in every generated app, but
          // verify anyway so a formatter that exits 0 without adding the
          // field stops here with instructions rather than a runtime crash.
          // On a re-run the field is already there, which is fine too.
          const formattedSchema = fs.readFileSync(schemaPath, 'utf-8')
          const userModel =
            formattedSchema.match(/\bmodel\s+User\s*\{[\s\S]*?\n\}/)?.[0] ?? ''

          if (!/^\s*memberships\s+Membership\[\]/m.test(userModel)) {
            if (editResult.outcome === 'forced') {
              task.output =
                'The `memberships` relation was not added to the `User` model, likely because of the clash from --force. Continuing with the rest of the setup; see "Next steps" for how to merge the appended models by hand.'
              return
            }

            throw new Error(
              '`prisma format` did not add the `memberships` relation to the `User` model. Add it by hand: `memberships Membership[]` as the last field of `model User { ... }`, then re-run this command.',
            )
          }
        },
      },
      {
        title: 'Wrapping api/src/lib/db with the tenancy Prisma extension...',
        task: async () => {
          const dbPath = path.join(paths.api.lib, `db.${ext}`)

          const transformResult = await runTransform({
            transformPath: path.join(import.meta.dirname, 'dbCodemod.js'),
            targetPaths: [dbPath],
            options:
              tenantField !== DEFAULT_TENANT_FIELD ? { tenantField } : {},
          })

          if (transformResult.error) {
            if (transformResult.error === 'CEDAR_CODEMOD_ERR_OLD_FORMAT') {
              const tenancySetup = formatCedarCommand(['setup', 'tenancy'])

              throw new Error(
                'It looks like your api/src/lib/db file is using the old ' +
                  'format. Please update it as per the v8 upgrade guide, ' +
                  `then run \`${tenancySetup}\` again.`,
              )
            }

            throw new Error(
              'Could not add the tenancy Prisma extension. Please modify ' +
                '`api/src/lib/db` by hand: wrap the `db` export in ' +
                '`.$extends(createTenancyExtension({ models: { allExcept: ' +
                "['user', 'organization', 'membership'] } }))`.",
            )
          }
        },
      },
      {
        title:
          'Adding memberships to getCurrentUser and the tenancy auth checks to api/src/lib/auth...',
        task: async (_ctx, task) => {
          if (!fs.existsSync(authPath)) {
            task.skip('No api/src/lib/auth file found; skipping.')
            return
          }

          const transformResult = await runTransform({
            transformPath: path.join(import.meta.dirname, 'authCodemod.js'),
            targetPaths: [authPath],
          })

          if (transformResult.error?.includes('AUTH_CHECKS_CHANGED')) {
            task.output = `api/src/lib/auth's requireAuth or hasRole has checks of its own, so it was left as it is. Please add this by hand, keeping your checks:\n${AUTH_SNIPPET}`
          } else if (transformResult.error) {
            task.output = `Could not update api/src/lib/auth automatically. Please add this by hand:\n${AUTH_SNIPPET}`
          }
        },
      },
      {
        title: 'Wiring api/src/functions/graphql for tenancy...',
        task: async () => {
          const transformResult = await runTransform({
            transformPath: path.join(import.meta.dirname, 'graphqlCodemod.js'),
            targetPaths: [graphqlPath],
          })

          if (transformResult.error) {
            if (
              transformResult.error ===
              'CEDAR_CODEMOD_ERR_GRAPHQL_CONTEXT_EXISTS'
            ) {
              throw new Error(
                'api/src/functions/graphql already has a `context` option. Please wire it up for tenancy by hand; see the multi-tenancy how-to for the shape it needs.',
              )
            }

            throw new Error(
              'Could not find `createGraphQLHandler({ ... })` in api/src/functions/graphql. Please wire it up for tenancy by hand; see the multi-tenancy how-to for the shape it needs.',
            )
          }
        },
        skip: () =>
          fs.existsSync(graphqlPath)
            ? false
            : 'No api/src/functions/graphql file found; skipping.',
      },
      {
        title: 'Adding the dbAuth signup handler for tenancy...',
        task: async (_ctx, task) => {
          const transformResult = await runTransform({
            transformPath: path.join(import.meta.dirname, 'signupCodemod.js'),
            targetPaths: [functionsAuthPath],
          })

          if (transformResult.error) {
            task.output = `Could not update the dbAuth signup handler automatically. Please add this to api/src/functions/auth's signupOptions:\n${SIGNUP_SNIPPET}`
          }
        },
        skip: () =>
          isDbAuthProject ? false : 'Not a dbAuth project; skipping.',
      },
      {
        title: 'Adding the permissions package...',
        task: () =>
          addPermissionsPackageTasks({
            cedarVersion,
            indexSource: fs.readFileSync(
              path.resolve(
                import.meta.dirname,
                'templates',
                'permissionsPackage.index.ts.template',
              ),
              'utf-8',
            ),
            force,
          }),
      },
      {
        title:
          'Adding permission checks and the requirePermission directive...',
        task: async () => {
          const replacements = {
            __PERMISSIONS_PACKAGE__: permissionsPackageName(),
          }

          await writeTemplateFile(
            'permissions.ts.template',
            path.join(paths.api.lib, `permissions.${ext}`),
            replacements,
          )

          const directiveDir = path.join(
            paths.api.directives,
            'requirePermission',
          )

          await writeTemplateFile(
            'requirePermission.ts.template',
            path.join(directiveDir, `requirePermission.${ext}`),
            replacements,
          )
          await writeTemplateFile(
            'requirePermission.test.ts.template',
            path.join(directiveDir, `requirePermission.test.${ext}`),
          )
        },
      },
      {
        title: 'Adding the organizations service...',
        task: async () => {
          const serviceDir = path.join(paths.api.services, 'organizations')

          // The tests and scenarios create users: give them every field
          // the app's User requires, not just dbAuth's
          const userFields = requiredUserFields(
            fs.readFileSync(
              await getSchemaPath(paths.api.prismaConfig),
              'utf-8',
            ),
          )
          // Numbered apart, as the scenario's users are there during the
          // tests, which create more
          const withUserFields = (firstNumber: number) => (content: string) =>
            addRequiredUserFields(content, userFields, { firstNumber })

          await writeTemplateFile(
            'organizations.ts.template',
            path.join(serviceDir, `organizations.${ext}`),
            { __PERMISSIONS_PACKAGE__: permissionsPackageName() },
          )
          await writeTemplateFile(
            'organizations.test.ts.template',
            path.join(serviceDir, `organizations.test.${ext}`),
            {},
            withUserFields(101),
          )
          await writeTemplateFile(
            'organizations.scenarios.ts.template',
            path.join(serviceDir, `organizations.scenarios.${ext}`),
            {},
            withUserFields(1),
          )
          await writeTemplateFile(
            'organizations.sdl.ts.template',
            path.join(paths.api.graphql, `organizations.sdl.${ext}`),
          )
        },
      },
      {
        title: 'Adding a data migration to backfill existing users...',
        task: async (_ctx, task) => {
          const dataMigrationsPath = await getDataMigrationsPath(
            paths.api.prismaConfig,
          )

          // Its name has a timestamp, so an earlier run's has another name
          const existing =
            fs.existsSync(dataMigrationsPath) &&
            fs
              .readdirSync(dataMigrationsPath)
              .find((file) =>
                /-ensure-default-organizations\.[jt]s$/.test(file),
              )

          if (existing) {
            task.skip(`Already added: ${existing}`)
            return
          }
          const timestamp = new Date()
            .toISOString()
            .split('.')[0]
            .replace(/\D/g, '')

          await writeTemplateFile(
            'ensureDefaultOrganizations.dataMigration.ts.template',
            path.join(
              dataMigrationsPath,
              `${timestamp}-ensure-default-organizations.${ext}`,
            ),
            {
              __DATA_MIGRATE_UP_COMMAND__: formatCedarCommand([
                'data-migrate',
                'up',
              ]),
              __PRISMA_MIGRATE_DEV_COMMAND__: formatCedarCommand([
                'prisma',
                'migrate',
                'dev',
              ]),
              __PRISMA_GENERATE_COMMAND__: formatCedarCommand([
                'prisma',
                'generate',
              ]),
            },
          )
        },
      },
      {
        title: 'Adding the tenancy and the invitation landing page...',
        task: async () => {
          await writeTemplateFile(
            'tenancy.tsx.template',
            path.join(paths.web.src, `tenancy.${componentExt}`),
          )
          await writeTemplateFile(
            'InvitePage.tsx.template',
            path.join(
              paths.web.pages,
              'InvitePage',
              `InvitePage.${componentExt}`,
            ),
          )
        },
      },
      {
        title: 'Passing the tenancy to the Router in web/src/Routes...',
        task: async (ctx, task) => {
          const routesPath = paths.web.routes

          if (!routesPath || !fs.existsSync(routesPath)) {
            ctx.routerNeedsTenancy = true
            task.skip('No web/src/Routes file found; skipping.')
            return
          }

          const source = fs.readFileSync(routesPath, 'utf-8')

          const transformResult = await runTransform({
            transformPath: path.join(import.meta.dirname, 'routerCodemod.js'),
            targetPaths: [routesPath],
          })

          if (transformResult.error) {
            ctx.routerNeedsTenancy = true
            task.output =
              "Could not find the app's <Router> in web/src/Routes, so left " +
              'it as it is. See the next steps for what to add.'
          } else if (fs.readFileSync(routesPath, 'utf-8') !== source) {
            writtenFiles.push(routesPath)
          }
        },
      },
      {
        title: 'Formatting and linting changed files...',
        task: async (_ctx, task) => {
          const changedFiles = [
            ...writtenFiles,
            ...['db', 'auth'].map((name) => path.join(paths.api.lib, name)),
            ...['graphql', 'auth'].map((name) =>
              path.join(paths.api.functions, name),
            ),
          ]
            .flatMap((file) =>
              path.extname(file) ? [file] : [`${file}.js`, `${file}.ts`],
            )
            .filter((file) => fs.existsSync(file))

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

          // Sorts the imports the codemods added the way the app's lint
          // rules want them, as `cedar generate package` does
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
          const migrateCommand = formatCedarCommand([
            'prisma',
            'migrate',
            'dev',
          ])
          const generateCommand = formatCedarCommand(['prisma', 'generate'])
          const dataMigrateCommand = formatCedarCommand(['data-migrate', 'up'])

          const modelsExistWarning =
            ctx.modelsExistOutcome === 'forced'
              ? c.error(
                  '\nschema.prisma is currently invalid (as requested by --force): merge the appended Organization/Membership blocks with your existing ones, then run `prisma format`.\n',
                )
              : ctx.modelsExistOutcome === 'skipped'
                ? c.warning(
                    '\nOrganization/Membership already existed and were left as-is: add the fields and relations printed above by hand before continuing.\n',
                  )
                : ''

          task.title = `Next steps...

          ${c.success('\nMulti-tenancy configured!\n')}
          ${modelsExistWarning}
          1. Run ${c.highlight(migrateCommand)} to create the Organization/Membership
             tables and ${c.highlight(generateCommand)} to update the Prisma client,
             then ${c.highlight(dataMigrateCommand)} to give every existing user a
             default organization.
          2. \`db.ts\`'s tenancy extension scopes every model except
             User/Organization/Membership. For each existing model (e.g.
             Contact) whose rows belong to one organization, add
             ${c.highlight('organizationId String')} plus ${c.highlight('@@index([organizationId])')} to it in
             schema.prisma, and switch its fields from ${c.highlight('@requireAuth')}
             to ${c.highlight('@requirePermission(permission: "organization.read")')}, or
             a permission of its own. For each one that stays global, add it
             to the ${c.highlight('allExcept')} list in api/src/lib/db instead.
          3. Put your organization routes in a PrivateSet in web/src/Routes.tsx.
             The Router renders the organization for it, using the generated
             web/src/tenancy, so there is nothing to wrap them with. A user
             who isn't signed in is sent to log in:

               <PrivateSet wrap={OrgLayout} unauthenticated="login">
                 <Route path="/org/{orgSlug}/projects" page={ProjectsPage} name="projects" />
               </PrivateSet>

             and add the invitation route outside it:

               <Route path="/invite/{token}" page={InvitePage} name="invite" />

             Routes with {orgSlug} outside a PrivateSet are public pages
             with no organization context.
${
  ctx.routerNeedsTenancy
    ? `
             Your ${c.highlight('<Router>')} couldn't be found, so pass it ${c.highlight('tenancy')} by
             hand, so it renders the organization for the routes below:

               import { tenancy } from 'src/tenancy'

               <Router useAuth={useAuth} tenancy={tenancy}>
`
    : ''
}
          4. Wrap any plain api/src/functions/* handler that touches
             tenant-owned models with ${c.highlight('withTenancy')} from ${c.highlight(
               '@cedarjs/tenancy',
             )}.
          5. Your permissions, and what each role may do, are in
             ${c.highlight('packages/permissions')}, shared by the api and web sides${
               ctx.packagesWorkspaceTurnedOn
                 ? ` (this
             turned on ${c.highlight('experimental.packagesWorkspace')} in cedar.toml)`
                 : ''
             }. A role is a bundle of
             permissions: guard organization fields with
             ${c.highlight('@requirePermission(permission: "...")')}, never a role, and check
             permissions on the web with ${c.highlight('useAuth().hasPermission()')}. Fields
             any member may use ask for ${c.highlight('organization.read')}, which every
             role lists.
          6. ${c.highlight('@requireAuth')} stays for fields about the signed-in user,
             and checks what it did: there were no organizations before.
             ${c.highlight('@requirePermission')} needs a current organization, and checks
             what the user's role there may do.
          7. Roles are the user's own: ${c.highlight('hasRole')} and ${c.highlight('<PrivateSet roles>')}
             still check ${c.highlight('currentUser.roles')}. In an organization, check a
             permission instead: guard routes with ${c.highlight('<PrivateSet orgPermission>')}
             for a permission of their membership in the route's organization.
             A member who lacks it is sent to ${c.highlight('unauthorized')}:

               <PrivateSet unauthenticated="login" unauthorized="projects" orgPermission="organization.manage">
                 <Route path="/org/{orgSlug}/settings" page={SettingsPage} name="settings" />
               </PrivateSet>

${
  keptFiles.length > 0
    ? `
          Kept these existing files rather than overwriting them (run with
          ${c.highlight('--force')} to overwrite):
${keptFiles.map((file) => `            ${path.relative(paths.base, file)}`).join('\n')}

`
    : ''
}          Check out the docs for more info:
          ${terminalLink('', 'https://cedarjs.com/docs/tenancy')}

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
