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
  AUTH_NOT_SET_UP_MESSAGE,
  hasWebAuthFile,
  noUserModelMessage,
} from './preflight.js'
import {
  editSchema,
  hasModel,
  MEMBERSHIP_MODEL,
  ORGANIZATION_MODEL,
} from './schemaPrisma.js'
import type { EditSchemaResult, ModelsExistOutcome } from './schemaPrisma.js'

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

interface TenancyCtx {
  /** Set once the schema-editing task runs; read by the "Next steps" task. */
  modelsExistOutcome?: ModelsExistOutcome
}

export const handler = async ({ tenantField, force }: TenancyOptions) => {
  const paths = getPaths()

  // Checked before anything is written, including with `--force`: without
  // auth and a `User` model there is nothing for memberships to hang off, so
  // every file this command writes would be wrong.
  if (!hasWebAuthFile(paths.web.src)) {
    console.error(c.error(AUTH_NOT_SET_UP_MESSAGE))
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
  ) => {
    const templatePath = path.resolve(
      import.meta.dirname,
      'templates',
      templateFile,
    )
    const templateContent = fs.readFileSync(templatePath, {
      encoding: 'utf8',
      flag: 'r',
    })
    const content = projectIsTypescript
      ? templateContent
      : await transformTSToJS(outputPath, templateContent)

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
              throw new Error(
                'No `User` model found in schema.prisma. Set up authentication first (e.g. `yarn cedar setup auth dbAuth`) before running `yarn cedar setup tenancy`.',
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
          // `Organization` already declares `memberships Membership[]`, so
          // the count should rise by one when the formatter adds the
          // back-relation to `User`.
          const membershipsOccurrences = (schema: string): number =>
            (schema.match(/memberships\s+Membership\[\]/g) ?? []).length

          const formattedSchema = fs.readFileSync(schemaPath, 'utf-8')

          if (
            membershipsOccurrences(formattedSchema) <=
            membershipsOccurrences(editResult.schema)
          ) {
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
              throw new Error(
                'It looks like your api/src/lib/db file is using the old format. Please update it as per the v8 upgrade guide, then run `yarn cedar setup tenancy` again.',
              )
            }

            throw new Error(
              "Could not add the tenancy Prisma extension. Please modify api/src/lib/db by hand: wrap the `db` export in `.$extends(createTenancyExtension({ models: { allExcept: ['user', 'organization', 'membership'] } }))`.",
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
        task: (ctx, task) => {
          const migrateCommand = formatCedarCommand([
            'prisma',
            'migrate',
            'dev',
          ])
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
