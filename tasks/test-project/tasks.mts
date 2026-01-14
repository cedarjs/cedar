import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'
import { Listr } from 'listr2'

import {
  createBuilder,
  createCells,
  createComponents,
  createLayout,
  fullPath,
  getOutputPath,
  getPagesTasks,
  setOutputPath,
  updateCellMocks,
  addModel,
} from './base-tasks.mts'
import { getPrerenderTasks } from './prerender-tasks.mts'
import {
  getExecaOptions,
  applyCodemod,
  updatePkgJsonScripts,
  getCfwBin,
} from './util.mts'

interface WebTasksOptions {
  linkWithLatestFwBuild: boolean
  verbose: boolean
}

export async function webTasks(
  outputPath: string,
  { linkWithLatestFwBuild, verbose }: WebTasksOptions,
) {
  setOutputPath(outputPath)

  return new Listr(
    [
      {
        title: 'Creating pages',
        task: () => new Listr(getPagesTasks()),
      },
      {
        title: 'Creating layout',
        task: () => createLayout(),
      },
      {
        title: 'Creating components',
        task: () => createComponents(),
      },
      {
        title: 'Creating cells',
        task: () => createCells(),
      },
      {
        title: 'Updating cell mocks',
        task: () => updateCellMocks(),
      },
      {
        title: 'Changing routes',
        task: () => applyCodemod('routes.js', fullPath('web/src/Routes')),
      },

      // ====== NOTE: cfw needs this workaround for tailwind =======
      // Setup tailwind in a linked project, due to cfw we install deps manually
      {
        title: 'Install tailwind dependencies',
        // @NOTE: use cfw, because calling the copy function doesn't seem to work here
        task: () =>
          execa(
            'yarn workspace web add -D postcss postcss-loader tailwindcss autoprefixer prettier-plugin-tailwindcss@^0.5.12',
            [],
            getExecaOptions(outputPath),
          ),
        enabled: () => linkWithLatestFwBuild,
      },
      {
        title: '[link] Copy local framework files again',
        // @NOTE: use cfw, because calling the copy function doesn't seem to work here
        task: () =>
          execa(
            `yarn ${getCfwBin(outputPath)} project:copy`,
            [],
            getExecaOptions(outputPath),
          ),
        enabled: () => linkWithLatestFwBuild,
      },
      // =========
      {
        title: 'Adding Tailwind',
        task: () => {
          return execa(
            'yarn cedar setup ui tailwindcss',
            ['--force', linkWithLatestFwBuild && '--no-install'].filter(
              (i: string | boolean): i is string => Boolean(i),
            ),
            getExecaOptions(outputPath),
          )
        },
      },
    ],
    {
      exitOnError: true,
      renderer: verbose ? 'verbose' : 'default',
    },
  )
}

interface ApiTasksOptions {
  verbose: boolean
  linkWithLatestFwBuild: boolean
}

export async function apiTasks(
  outputPath: string,
  { verbose, linkWithLatestFwBuild }: ApiTasksOptions,
) {
  setOutputPath(outputPath)

  const addDbAuth = async () => {
    // Temporarily disable postinstall script
    updatePkgJsonScripts({
      projectPath: outputPath,
      scripts: {
        postinstall: '',
      },
    })

    const dbAuthSetupPath = path.join(
      outputPath,
      'node_modules',
      '@cedarjs',
      'auth-dbauth-setup',
    )

    // At an earlier step we run `yarn cfw project:copy` which gives us
    // auth-dbauth-setup@3.2.0 currently. We need that version to be a canary
    // version for auth-dbauth-api and auth-dbauth-web package installations
    // to work. So we remove the current version and add a canary version
    // instead.

    fs.rmSync(dbAuthSetupPath, { recursive: true, force: true })

    await execa(
      'yarn cedar setup auth dbAuth --force --no-webauthn',
      [],
      getExecaOptions(outputPath),
    )

    // Restore postinstall script
    updatePkgJsonScripts({
      projectPath: outputPath,
      scripts: {
        postinstall: `yarn ${getCfwBin(outputPath)} project:copy`,
      },
    })

    if (linkWithLatestFwBuild) {
      await execa(
        `yarn ${getCfwBin(outputPath)} project:copy`,
        [],
        getExecaOptions(outputPath),
      )
    }

    await execa(
      'yarn cedar g dbAuth --no-webauthn --username-label=username --password-label=password',
      [],
    )

    // update directive in contacts.sdl.ts
    const pathContactsSdl = `${getOutputPath()}/api/src/graphql/contacts.sdl.ts`
    const contentContactsSdl = fs.readFileSync(pathContactsSdl, 'utf-8')
    const resultsContactsSdl = contentContactsSdl
      .replace(
        'createContact(input: CreateContactInput!): Contact! @requireAuth',
        'createContact(input: CreateContactInput!): Contact @skipAuth',
      )
      .replace(
        'deleteContact(id: Int!): Contact! @requireAuth',
        'deleteContact(id: Int!): Contact! @requireAuth(roles:["ADMIN"])',
      ) // make deleting contacts admin only
    fs.writeFileSync(pathContactsSdl, resultsContactsSdl)

    // update directive in posts.sdl.ts
    const pathPostsSdl = `${getOutputPath()}/api/src/graphql/posts.sdl.ts`
    const contentPostsSdl = fs.readFileSync(pathPostsSdl, 'utf-8')
    const resultsPostsSdl = contentPostsSdl.replace(
      /posts: \[Post!\]! @requireAuth([^}]*)@requireAuth/,
      `posts: [Post!]! @skipAuth
      post(id: Int!): Post @skipAuth`,
    ) // make posts accessible to all

    fs.writeFileSync(pathPostsSdl, resultsPostsSdl)

    // Update src/lib/auth to return roles, so tsc doesn't complain
    const libAuthPath = `${getOutputPath()}/api/src/lib/auth.ts`
    const libAuthContent = fs.readFileSync(libAuthPath, 'utf-8')

    const newLibAuthContent = libAuthContent
      .replace(
        'select: { id: true }',
        'select: { id: true, roles: true, email: true}',
      )
      .replace(
        'const currentUserRoles = context.currentUser?.roles',
        'const currentUserRoles = context.currentUser?.roles as string | string[]',
      )
    fs.writeFileSync(libAuthPath, newLibAuthContent)

    // update requireAuth test
    const pathRequireAuth = `${getOutputPath()}/api/src/directives/requireAuth/requireAuth.test.ts`
    const contentRequireAuth = fs.readFileSync(pathRequireAuth).toString()
    const resultsRequireAuth = contentRequireAuth.replace(
      /const mockExecution([^}]*){} }\)/,
      `const mockExecution = mockRedwoodDirective(requireAuth, {
        context: { currentUser: { id: '4c3d3e8e-2b1a-4f5c-8c7d-9e0f1a2b3c4d', roles: 'ADMIN', email: 'b@zinga.com' } },
      })`,
    )
    fs.writeFileSync(pathRequireAuth, resultsRequireAuth)

    // add fullName input to signup form
    const pathSignupPageTs = `${getOutputPath()}/web/src/pages/SignupPage/SignupPage.tsx`
    const contentSignupPageTs = fs.readFileSync(pathSignupPageTs, 'utf-8')
    const usernameFieldsMatches = contentSignupPageTs.match(
      /\s*<Label[\s\S]*?name="username"[\s\S]*?"rw-field-error" \/>/,
    )
    if (usernameFieldsMatches) {
      const fullNameFields = usernameFieldsMatches[0]
        .replace(/\s*ref=\{usernameRef}/, '')
        .replaceAll('username', 'full-name')
        .replaceAll('Username', 'Full Name')

      const newContentSignupPageTs = contentSignupPageTs
        .replace(
          '<FieldError name="password" className="rw-field-error" />',
          '<FieldError name="password" className="rw-field-error" />\n' +
            fullNameFields,
        )
        // include full-name in the data we pass to `signUp()`
        .replace(
          'password: data.password',
          "password: data.password, 'full-name': data['full-name']",
        )

      fs.writeFileSync(pathSignupPageTs, newContentSignupPageTs)
    }

    // set fullName when signing up
    const pathAuthTs = `${getOutputPath()}/api/src/functions/auth.ts`
    const contentAuthTs = fs.readFileSync(pathAuthTs).toString()
    const resultsAuthTs = contentAuthTs
      .replace('name: string', "'full-name': string")
      .replace('userAttributes: _userAttributes', 'userAttributes')
      .replace(
        '// name: userAttributes.name',
        "fullName: userAttributes['full-name']",
      )

    fs.writeFileSync(pathAuthTs, resultsAuthTs)
  }

  const generateScaffold = createBuilder('yarn cedar g scaffold')

  return new Listr(
    [
      {
        title: 'Adding post model to prisma',
        task: async () => {
          // Need both here since they have a relation
          const { post, user } = await import('./codemods/models.mts')

          addModel(post)
          addModel(user)

          return execa(
            `yarn cedar prisma migrate dev --name create_post_user`,
            [],
            getExecaOptions(outputPath),
          )
        },
      },
      {
        title: 'Scaffolding post',
        task: async () => {
          await generateScaffold('post')

          // Replace the random numbers in the scenario with consistent values
          await applyCodemod(
            'scenarioValueSuffix.js',
            fullPath('api/src/services/posts/posts.scenarios'),
          )

          await execa(
            `yarn ${getCfwBin(outputPath)} project:copy`,
            [],
            getExecaOptions(outputPath),
          )
        },
      },
      {
        title: 'Adding seed script',
        task: async () => {
          await applyCodemod(
            'seed.js',
            fullPath('scripts/seed.ts', { addExtension: false }),
          )
        },
      },
      {
        title: 'Adding contact model to prisma',
        task: async () => {
          const { contact } = await import('./codemods/models.mts')

          addModel(contact)

          await execa(
            'yarn cedar prisma migrate dev --name create_contact',
            [],
            getExecaOptions(outputPath),
          )

          await generateScaffold('contacts')
        },
      },
      {
        // This task renames the migration folders so that we don't have to deal with duplicates/conflicts when committing to the repo
        title: 'Adjust dates within migration folder names',
        task: () => {
          if (!getOutputPath()) {
            throw new Error('Output path not set')
          }

          const migrationsFolderPath = path.join(
            getOutputPath(),
            'api',
            'db',
            'migrations',
          )
          // Migration folders are folders which start with 14 digits because they have a yyyymmddhhmmss
          const migrationFolders = fs
            .readdirSync(migrationsFolderPath)
            .filter((name) => {
              return (
                name.match(/\d{14}.+/) &&
                fs
                  .lstatSync(path.join(migrationsFolderPath, name))
                  .isDirectory()
              )
            })
            .sort()
          const datetime = new Date('2022-01-01T12:00:00.000Z')
          migrationFolders.forEach((name) => {
            const datetimeInCorrectFormat =
              datetime.getFullYear() +
              ('0' + (datetime.getMonth() + 1)).slice(-2) +
              ('0' + datetime.getDate()).slice(-2) +
              ('0' + datetime.getHours()).slice(-2) +
              ('0' + datetime.getMinutes()).slice(-2) +
              ('0' + datetime.getSeconds()).slice(-2)
            fs.renameSync(
              path.join(migrationsFolderPath, name),
              path.join(
                migrationsFolderPath,
                `${datetimeInCorrectFormat}${name.substring(14)}`,
              ),
            )
            datetime.setDate(datetime.getDate() + 1)
          })
        },
      },
      {
        title: 'Add dbAuth',
        task: async () => addDbAuth(),
      },
      {
        title: 'Add users service',
        task: async () => {
          const generateSdl = createBuilder('yarn cedar g sdl --no-crud')

          await generateSdl('user')

          await applyCodemod(
            'usersSdl.js',
            fullPath('api/src/graphql/users.sdl'),
          )

          await applyCodemod(
            'usersService.js',
            fullPath('api/src/services/users/users'),
          )

          // Replace the random numbers in the scenario with consistent values
          await applyCodemod(
            'scenarioValueSuffix.js',
            fullPath('api/src/services/users/users.scenarios'),
          )

          const test = `import { user } from './users.js'
            import type { StandardScenario } from './users.scenarios.js'

            describe('users', () => {
              scenario('returns a single user', async (scenario: StandardScenario) => {
                const result = await user({ id: scenario.user.one.id })

                expect(result).toEqual(scenario.user.one)
              })
            })`.replaceAll(/ {12}/g, '')

          fs.writeFileSync(fullPath('api/src/services/users/users.test'), test)

          return createBuilder('yarn cedar g types')()
        },
      },
      {
        title: 'Add describeScenario tests',
        task: async () => {
          // Copy contact.scenarios.ts, because scenario tests look for the same filename
          fs.copyFileSync(
            fullPath('api/src/services/contacts/contacts.scenarios'),
            fullPath('api/src/services/contacts/describeContacts.scenarios'),
          )

          // Create describeContacts.test.ts
          const describeScenarioFixture = path.join(
            import.meta.dirname,
            'templates',
            'api',
            'contacts.describeScenario.test.ts.template',
          )

          fs.copyFileSync(
            describeScenarioFixture,
            fullPath('api/src/services/contacts/describeContacts.test'),
          )
        },
      },
      {
        // This is probably more of a web side task really, but the scaffolded
        // pages aren't generated until we get here to the api side tasks. So
        // instead of doing some up in the web side tasks, and then the rest
        // here I decided to move all of them here
        title: 'Add Prerender to Routes',
        task: () => new Listr(getPrerenderTasks()),
      },
    ],
    {
      exitOnError: true,
      renderer: verbose ? 'verbose' : 'default',
    },
  )
}
