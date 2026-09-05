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
import { runTransitiveBin } from '@cedarjs/cli-helpers/packageManager/exec'
import { getDataMigrationsPath, getSchemaPath } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import { getPaths, transformTSToJS, writeFile } from '../../../lib/index.js'
import { isTypeScriptProject } from '../../../lib/project.js'
import { runTransform } from '../../../lib/runTransform.js'

import {
  authNotSetUpMessage,
  hasWebAuthFile,
  noUserModelMessage,
} from './preflight.js'
import { editSchema, hasModel } from './schemaPrisma.js'

const DEFAULT_TENANT_FIELD = 'organizationId'

const AUTH_SNIPPET = `
  export const getCurrentUser = async (session) => {
    return await db.user.findUnique({
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
    })
  }

  export { hasOrgRole, requireMembership } from '@cedarjs/tenancy'
`

const SIGNUP_SNIPPET = `
  handler: async ({ username, hashedPassword, salt, userAttributes }) => {
    const user = await db.user.create({
      data: { email: username, hashedPassword, salt },
    })

    await ensureDefaultOrganization({
      currentUser: user,
      invitationToken: userAttributes.invitationToken,
    })

    return user
  },
`

interface TenancyOptions {
  tenantField: string
  force: boolean
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

  const writeTemplateFile = async (
    templateFile: string,
    outputPath: string,
    replacements: Record<string, string> = {},
  ) => {
    const dirname = import.meta.dirname
    const templatePath = path.resolve(dirname, 'templates', templateFile)
    let templateContent = fs.readFileSync(templatePath, 'utf-8')

    for (const [token, value] of Object.entries(replacements)) {
      templateContent = templateContent.replaceAll(token, value)
    }

    const content = projectIsTypescript
      ? templateContent
      : await transformTSToJS(outputPath, templateContent)

    return writeFile(outputPath, content, { overwriteExisting: force })
  }

  const tasks = new Listr(
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
        task: async () => {
          const schemaPath = await getSchemaPath(paths.api.prismaConfig)
          const schema = fs.readFileSync(schemaPath, 'utf-8')

          let updatedSchema: string

          try {
            updatedSchema = editSchema(schema, { force })
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

            if (message === 'CEDAR_TENANCY_ERR_MODELS_EXIST') {
              throw new Error(
                '`Organization` and/or `Membership` models already exist in ' +
                  'schema.prisma. Re-run with --force to keep them as-is and ' +
                  'continue with the rest of the setup.',
              )
            }

            throw e
          }

          fs.writeFileSync(schemaPath, updatedSchema)

          // Adds the `memberships` back-relation on `User`: appending
          // `Organization` and `Membership`, both of which declare a relation
          // to `User`, is enough for Prisma's formatter to add the matching
          // field. Not best-effort -- the generated `getCurrentUser` selects
          // `memberships`, so a schema without it breaks at runtime.
          try {
            await runTransitiveBin(
              'prisma',
              ['format', '--config', paths.api.prismaConfig],
              { cwd: paths.base },
            )
          } catch {
            throw new Error(
              '`prisma format` failed, so the `memberships` relation was not added to the `User` model. Add it by hand: `memberships Membership[]` as the last field of `model User { ... }`, then re-run this command.',
            )
          }

          // The field name comes from the formatter, not from us. A rename
          // would break loudly at type-check in every generated app, but
          // verify anyway so a formatter that exits 0 without adding the
          // field stops here with instructions rather than a runtime crash.
          // `Organization` already declares `memberships Membership[]`, so
          // the count should rise by one when the formatter adds the
          // back-relation to `User`.
          const membershipsOccurrences = (schema: string): number =>
            (schema.match(/memberships\s+Membership\[\]/g) ?? []).length

          const formattedSchema = fs.readFileSync(schemaPath, 'utf-8')

          if (
            membershipsOccurrences(formattedSchema) <=
            membershipsOccurrences(updatedSchema)
          ) {
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
          'Adding memberships to getCurrentUser and re-exporting tenancy helpers...',
        task: async (_ctx, task) => {
          if (!fs.existsSync(authPath)) {
            task.skip('No api/src/lib/auth file found; skipping.')
            return
          }

          const transformResult = await runTransform({
            transformPath: path.join(import.meta.dirname, 'authCodemod.js'),
            targetPaths: [authPath],
          })

          if (transformResult.error) {
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
        title: 'Adding the requireMembership directive...',
        task: async () => {
          const directiveDir = path.join(
            paths.api.directives,
            'requireMembership',
          )

          await writeTemplateFile(
            'requireMembership.ts.template',
            path.join(directiveDir, `requireMembership.${ext}`),
          )
          await writeTemplateFile(
            'requireMembership.test.ts.template',
            path.join(directiveDir, `requireMembership.test.${ext}`),
          )
        },
      },
      {
        title: 'Adding the organizations service...',
        task: async () => {
          const serviceDir = path.join(paths.api.services, 'organizations')

          await writeTemplateFile(
            'organizations.ts.template',
            path.join(serviceDir, `organizations.${ext}`),
          )
          await writeTemplateFile(
            'organizations.test.ts.template',
            path.join(serviceDir, `organizations.test.${ext}`),
          )
          await writeTemplateFile(
            'organizations.scenarios.ts.template',
            path.join(serviceDir, `organizations.scenarios.${ext}`),
          )
          await writeTemplateFile(
            'organizations.sdl.ts.template',
            path.join(paths.api.graphql, `organizations.sdl.${ext}`),
          )
        },
      },
      {
        title: 'Adding a data migration to backfill existing users...',
        task: async () => {
          const dataMigrationsPath = await getDataMigrationsPath(
            paths.api.prismaConfig,
          )
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
            },
          )
        },
      },
      {
        title: 'Adding OrgScope and the invitation landing page...',
        task: async () => {
          await writeTemplateFile(
            'OrgScope.tsx.template',
            path.join(
              paths.web.components,
              'OrgScope',
              `OrgScope.${componentExt}`,
            ),
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
        title: 'Prettifying changed files',
        task: async (_ctx, task) => {
          const prettifyPaths = [
            path.join(paths.api.lib, 'db.js'),
            path.join(paths.api.lib, 'db.ts'),
            path.join(paths.api.lib, 'auth.js'),
            path.join(paths.api.lib, 'auth.ts'),
            path.join(paths.api.functions, 'graphql.js'),
            path.join(paths.api.functions, 'graphql.ts'),
            path.join(paths.api.functions, 'auth.js'),
            path.join(paths.api.functions, 'auth.ts'),
          ]

          for (const prettifyPath of prettifyPaths) {
            try {
              if (!fs.existsSync(prettifyPath)) {
                continue
              }
              const source = fs.readFileSync(prettifyPath, 'utf-8')
              const prettierOptions = await getPrettierOptions()
              const prettifiedApp = await format(source, {
                ...prettierOptions,
                parser: 'babel-ts',
              })

              fs.writeFileSync(prettifyPath, prettifiedApp, 'utf-8')
            } catch {
              task.output =
                "Couldn't prettify the changes. Please reformat the files manually if needed."
            }
          }
        },
      },
      {
        title: 'Next steps...',
        task: (_ctx, task) => {
          const migrateCommand = formatCedarCommand([
            'prisma',
            'migrate',
            'dev',
          ])
          const dataMigrateCommand = formatCedarCommand(['data-migrate', 'up'])

          task.title = `Next steps...

          ${c.success('\nMulti-tenancy configured!\n')}

          1. Run ${c.highlight(migrateCommand)} to create the Organization/Membership
             tables, then ${c.highlight(dataMigrateCommand)} to give every existing
             user a default organization.
          2. \`db.ts\`'s tenancy extension scopes every model except
             User/Organization/Membership. For each existing model (e.g.
             Contact) whose rows belong to one organization, add ${c.highlight('organizationId String')} plus ${c.highlight('@@index([organizationId])')}
             to it in schema.prisma; for each one that stays global, add it
             to the ${c.highlight('allExcept')} list in api/src/lib/db instead.
          3. Wrap your organization routes with the generated OrgScope in
             web/src/Routes.tsx:

               <Set wrap={OrgScope}>
                 <Route path="/org/{orgSlug}/projects" page={ProjectsPage} name="projects" />
               </Set>

             and add the invitation route outside it:

               <Route path="/invite/{token}" page={InvitePage} name="invite" />

          4. Wrap any plain api/src/functions/* handler that touches
             tenant-owned models with ${c.highlight('withTenancy')} from ${c.highlight(
               '@cedarjs/tenancy',
             )}.

          Check out the docs for more info:
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
