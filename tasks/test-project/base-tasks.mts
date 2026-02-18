import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'

import { fullPath, getOutputPath } from './paths.mts'
import { getPrerenderTasks } from './prerender-tasks.mts'
import {
  getExecaOptions,
  applyCodemod,
  updatePkgJsonScripts,
  getCfwBin,
  // TODO: See if we can get rid of this and just use execa directly
  exec,
} from './util.mts'

/**
 * @param cmd The command to run
 */
export function createBuilder(cmd: string, dir = '') {
  const execaOptions = getExecaOptions(path.join(getOutputPath(), dir))

  return async function createItem(positionals?: string | string[]) {
    const args = positionals
      ? Array.isArray(positionals)
        ? positionals
        : [positionals]
      : []
    return execa(cmd, args, execaOptions)
  }
}

function getPagesTasks() {
  // Passing 'web' here to test executing 'yarn cedar' in the /web directory
  // to make sure it works as expected. We do the same for the /api directory
  // further down in this file.
  const createPage = createBuilder('yarn cedar g page', 'web')

  return [
    {
      title: 'Creating home page',
      task: async () => {
        await createPage('home /')

        await applyCodemod(
          'homePage.js',
          fullPath('web/src/pages/HomePage/HomePage'),
        )
      },
    },
    {
      title: 'Creating about page',
      task: async () => {
        await createPage('about')

        await applyCodemod(
          'aboutPage.js',
          fullPath('web/src/pages/AboutPage/AboutPage'),
        )
      },
    },
    {
      title: 'Creating contact page',
      task: async () => {
        await createPage('contactUs /contact')

        await applyCodemod(
          'contactUsPage.js',
          fullPath('web/src/pages/ContactUsPage/ContactUsPage'),
        )
      },
    },
    {
      title: 'Creating blog post page',
      task: async () => {
        await createPage('blogPost /blog-post/{id:Int}')

        await applyCodemod(
          'blogPostPage.js',
          fullPath('web/src/pages/BlogPostPage/BlogPostPage'),
        )

        return applyCodemod(
          'updateBlogPostPageStories.js',
          fullPath('web/src/pages/BlogPostPage/BlogPostPage.stories'),
        )
      },
    },
    {
      title: 'Creating profile page',
      task: async () => {
        await createPage('profile /profile')

        // Update the profile page test
        const testFileContent = `import { render, waitFor, screen } from '@cedarjs/testing/web'

      import ProfilePage from './ProfilePage'

      describe('ProfilePage', () => {
        it('renders successfully', async () => {
          mockCurrentUser({
            email: 'danny@bazinga.com',
            id: '84849020-2b1a-4f5c-8c7d-000084849020',
            roles: 'BAZINGA',
          })

          await waitFor(async () => {
            expect(() => {
              render(<ProfilePage />)
            }).not.toThrow()
          })

          expect(await screen.findByText('danny@bazinga.com')).toBeInTheDocument()
        })
      })
      `

        fs.writeFileSync(
          fullPath('web/src/pages/ProfilePage/ProfilePage.test'),
          testFileContent,
        )

        return applyCodemod(
          'profilePage.js',
          fullPath('web/src/pages/ProfilePage/ProfilePage'),
        )
      },
    },
    {
      title: 'Creating MDX Storybook stories',
      task: () => {
        const cedarMdxStoryContent = fs.readFileSync(
          `${path.resolve(import.meta.dirname, 'codemods', 'CedarJS.mdx')}`,
        )

        fs.writeFileSync(
          fullPath('web/src/CedarJS.mdx', { addExtension: false }),
          cedarMdxStoryContent,
        )

        return
      },
    },
    {
      title: 'Creating nested cells test page',
      task: async () => {
        await createPage('waterfall {id:Int}')

        await applyCodemod(
          'waterfallPage.js',
          fullPath('web/src/pages/WaterfallPage/WaterfallPage'),
        )

        await applyCodemod(
          'updateWaterfallPageStories.js',
          fullPath('web/src/pages/WaterfallPage/WaterfallPage.stories'),
        )
      },
    },
  ]
}

export function webTasksList() {
  const taskList = [
    {
      title: 'Creating pages',
      task: async () => getPagesTasks(),
      isNested: true,
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
  ]

  return taskList
}

export function apiTasksList({
  dbAuth,
  linkWithLatestFwBuild = false,
  esmProject = false,
}: {
  dbAuth: 'local' | 'canary'
  linkWithLatestFwBuild?: boolean
  esmProject?: boolean
}) {
  const execaOptions = getExecaOptions(getOutputPath())
  const generateScaffold = createBuilder('yarn cedar g scaffold')

  const taskList = [
    {
      title: 'Adding post and user model to prisma',
      task: async () => {
        // Need both here since they have a relation
        const { post, user } = await import('./codemods/models.mts')

        addModel(post)
        addModel(user)

        return exec(
          `yarn cedar prisma migrate dev --name create_post_user`,
          [],
          execaOptions,
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
      },
    },
    {
      title: 'Adding seed script',
      task: () => {
        return applyCodemod(
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

        await exec(
          `yarn cedar prisma migrate dev --name create_contact`,
          [],
          execaOptions,
        )

        await generateScaffold('contacts')

        const contactsServicePath = fullPath(
          'api/src/services/contacts/contacts',
        )
        fs.writeFileSync(
          contactsServicePath,
          fs
            .readFileSync(contactsServicePath, 'utf-8')
            .replace(
              "import { db } from 'src/lib/db'",
              '// Testing aliased imports with extensions\n' +
                "import { db } from 'src/lib/db.js'",
            ),
        )

        const contactsTestPath = fullPath(
          'api/src/services/contacts/contacts.test',
        )
        const contactsTest = fs.readFileSync(contactsTestPath, 'utf-8')

        // Doing simple string replacing here allows me better control over
        // blank lines compared to proper codemods with jscodeshift
        fs.writeFileSync(
          contactsTestPath,
          contactsTest
            .replace(
              "describe('contacts', () => {",
              "describe('contacts', () => {\n" +
                '  afterEach(() => {\n' +
                '    jest.mocked(console).log.mockRestore?.()\n' +
                '  })\n',
            )
            .replace(
              "  scenario('creates a contact', async () => {",
              "  scenario('creates a contact', async () => {\n" +
                "    jest.spyOn(console, 'log').mockImplementation(() => {})\n",
            ),
        )

        return applyCodemod('contacts.mts', contactsServicePath)
      },
    },
    {
      // This task renames the migration folders so that we don't have to deal
      // with duplicates/conflicts when committing to the repo
      title: 'Adjust dates within migration folder names',
      task: () => {
        const migrationsFolderPath = path.join(
          getOutputPath(),
          'api',
          'db',
          'migrations',
        )
        // Migration folders are folders which start with 14 digits because they
        // have a yyyymmddhhmmss
        const migrationFolders = fs
          .readdirSync(migrationsFolderPath)
          .filter((name) => {
            return (
              name.match(/\d{14}.+/) &&
              fs.lstatSync(path.join(migrationsFolderPath, name)).isDirectory()
            )
          })
          .sort()
        const datetime = new Date('2022-01-01T12:00:00.000Z')
        migrationFolders.forEach((name) => {
          const datetimeInCorrectFormat =
            datetime.getFullYear() +
            ('0' + (datetime.getMonth() + 1)).slice(-2) +
            ('0' + datetime.getDate()).slice(-2) +
            '120000' // Time hardcoded to 12:00:00 to limit TZ issues
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
      title: 'Add users service',
      task: async () => {
        const generateSdl = createBuilder('yarn cedar g sdl --no-crud', 'api')

        await generateSdl('user')

        await applyCodemod('usersSdl.js', fullPath('api/src/graphql/users.sdl'))

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
      title: 'Add dbAuth',
      task: async () =>
        addDbAuth(dbAuth === 'local', getOutputPath(), linkWithLatestFwBuild),
    },
    {
      title: 'Add describeScenario tests',
      task: () => {
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
      // instead of doing some up in the web side tasks, and then the rest here
      // I decided to move all of them here
      title: 'Add Prerender to Routes',
      task: async () => getPrerenderTasks(),
      isNested: true,
    },
    {
      title: 'Add context tests',
      task: () => {
        const templatePath = path.join(
          import.meta.dirname,
          'templates',
          'api',
          'context.test.ts.template',
        )
        const projectPath = path.join(
          getOutputPath(),
          'api',
          'src',
          '__tests__',
          'context.test.ts',
        )

        fs.mkdirSync(path.dirname(projectPath), { recursive: true })
        fs.writeFileSync(projectPath, fs.readFileSync(templatePath))
      },
    },
    {
      title: 'Add vitest db import tracking tests for ESM test project',
      task: () => {
        if (!esmProject) {
          return
        }

        const templatesDir = path.join(import.meta.dirname, 'templates', 'api')
        const templatePath1 = path.join(templatesDir, '1-db-import.test.ts')
        const templatePath2 = path.join(templatesDir, '2-db-import.test.ts')
        const templatePath3 = path.join(templatesDir, '3-db-import.test.ts')

        const testsDir = path.join(getOutputPath(), 'api', 'src', '__tests__')
        const testFilePath1 = path.join(testsDir, '1-db-import.test.ts')
        const testFilePath2 = path.join(testsDir, '2-db-import.test.ts')
        const testFilePath3 = path.join(testsDir, '3-db-import.test.ts')

        fs.mkdirSync(testsDir, { recursive: true })
        fs.copyFileSync(templatePath1, testFilePath1)
        fs.copyFileSync(templatePath2, testFilePath2)
        fs.copyFileSync(templatePath3, testFilePath3)

        // I opted to add an additional vitest config file rather than modifying
        // the existing one because I wanted to keep one looking exactly the
        // same as it'll look in user's projects.
        fs.copyFileSync(
          path.join(templatesDir, 'vitest-sort.config.ts'),
          path.join(getOutputPath(), 'api', 'vitest-sort.config.ts'),
        )
      },
    },
  ]

  return taskList
}

export async function createLayout() {
  const createLayout = createBuilder('yarn cedar g layout')

  await createLayout('blog')

  return applyCodemod(
    'blogLayout.js',
    fullPath('web/src/layouts/BlogLayout/BlogLayout'),
  )
}

export async function createComponents() {
  const createComponent = createBuilder('yarn cedar g component')

  await createComponent('blogPost')

  await applyCodemod(
    'blogPost.js',
    fullPath('web/src/components/BlogPost/BlogPost'),
  )

  await createComponent('author')

  await applyCodemod('author.js', fullPath('web/src/components/Author/Author'))

  await applyCodemod(
    'updateAuthorStories.js',
    fullPath('web/src/components/Author/Author.stories'),
  )

  await applyCodemod(
    'updateAuthorTest.js',
    fullPath('web/src/components/Author/Author.test'),
  )

  await createComponent('classWithClassField')

  await applyCodemod(
    'classWithClassField.ts',
    fullPath('web/src/components/ClassWithClassField/ClassWithClassField'),
  )
}

export async function createCells() {
  const createCell = createBuilder('yarn cedar g cell')

  await createCell('blogPosts')

  await applyCodemod(
    'blogPostsCell.js',
    fullPath('web/src/components/BlogPostsCell/BlogPostsCell'),
  )

  await createCell('blogPost')

  await applyCodemod(
    'blogPostCell.js',
    fullPath('web/src/components/BlogPostCell/BlogPostCell'),
  )

  await createCell('author')

  await applyCodemod(
    'authorCell.js',
    fullPath('web/src/components/AuthorCell/AuthorCell'),
  )

  await applyCodemod(
    'updateAuthorCellTest.js',
    fullPath('web/src/components/AuthorCell/AuthorCell.test'),
  )

  await createCell('waterfallBlogPost')

  return applyCodemod(
    'waterfallBlogPostCell.js',
    fullPath('web/src/components/WaterfallBlogPostCell/WaterfallBlogPostCell'),
  )
}

export async function updateCellMocks() {
  await applyCodemod(
    'updateBlogPostMocks.js',
    fullPath('web/src/components/BlogPostCell/BlogPostCell.mock.ts', {
      addExtension: false,
    }),
  )

  await applyCodemod(
    'updateBlogPostMocks.js',
    fullPath('web/src/components/BlogPostsCell/BlogPostsCell.mock.ts', {
      addExtension: false,
    }),
  )

  await applyCodemod(
    'updateAuthorCellMock.js',
    fullPath('web/src/components/AuthorCell/AuthorCell.mock.ts', {
      addExtension: false,
    }),
  )

  return applyCodemod(
    'updateWaterfallBlogPostMocks.js',
    fullPath(
      'web/src/components/WaterfallBlogPostCell/WaterfallBlogPostCell.mock.ts',
      {
        addExtension: false,
      },
    ),
  )
}

export async function addModel(schema: string) {
  const prismaPath = `${getOutputPath()}/api/db/schema.prisma`

  const current = fs.readFileSync(prismaPath, 'utf-8')

  fs.writeFileSync(prismaPath, `${current.trim()}\n\n${schema}\n`)
}

async function addDbAuth(
  localDbAuth: boolean,
  outputPath: string,
  linkWithLatestFwBuild: boolean,
) {
  const execaOptions = getExecaOptions(outputPath)

  // Temporarily disable postinstall script
  updatePkgJsonScripts({
    projectPath: outputPath,
    scripts: {
      postinstall: '',
    },
  })

  // (This is really only needed for `tasks.mts`)
  const dbAuthSetupPath = path.join(
    outputPath,
    'node_modules',
    '@cedarjs',
    'auth-dbauth-setup',
  )

  // At an earlier step we run `yarn cfw project:copy` which gives us
  // auth-dbauth-setup@3.2.0 currently. We need that version to be a canary
  // version for auth-dbauth-api and auth-dbauth-web package installations to
  // work. So we remove the current version and add let `setupDbAuth()` install
  // the correct version.
  // (This step is really only needed for `tasks.mts`)
  fs.rmSync(dbAuthSetupPath, { recursive: true, force: true })

  let existingResolutions
  let projectPackageJsonPath = ''
  let projectPackageJson: { resolutions?: Record<string, string> } = {}
  let setupTgzDest = ''
  let apiTgzDest = ''
  let webTgzDest = ''

  if (localDbAuth) {
    // We want to use the latest version of the auth-dbauth-{setup,api,web}
    // packages. But they're not published yet. So let's package them up as
    // tarballs and install them using that by setting yarn resolutions

    const cedarFrameworkPath = path.join(import.meta.dirname, '../../')
    const dbAuthPackagePath = path.join(
      cedarFrameworkPath,
      'packages',
      'auth-providers',
      'dbAuth',
    )
    const setupPkg = path.join(dbAuthPackagePath, 'setup')
    const apiPkg = path.join(dbAuthPackagePath, 'api')
    const webPkg = path.join(dbAuthPackagePath, 'web')

    await Promise.all([
      exec('yarn build:pack', [], getExecaOptions(setupPkg)),
      exec('yarn build:pack', [], getExecaOptions(apiPkg)),
      exec('yarn build:pack', [], getExecaOptions(webPkg)),
    ])

    const setupTgz = path.join(setupPkg, 'cedarjs-auth-dbauth-setup.tgz')
    const apiTgz = path.join(apiPkg, 'cedarjs-auth-dbauth-api.tgz')
    const webTgz = path.join(webPkg, 'cedarjs-auth-dbauth-web.tgz')

    setupTgzDest = path.join(outputPath, 'cedarjs-auth-dbauth-setup.tgz')
    apiTgzDest = path.join(outputPath, 'cedarjs-auth-dbauth-api.tgz')
    webTgzDest = path.join(outputPath, 'cedarjs-auth-dbauth-web.tgz')

    fs.copyFileSync(setupTgz, setupTgzDest)
    fs.copyFileSync(apiTgz, apiTgzDest)
    fs.copyFileSync(webTgz, webTgzDest)

    projectPackageJsonPath = path.join(outputPath, 'package.json')
    projectPackageJson = JSON.parse(
      fs.readFileSync(projectPackageJsonPath, 'utf-8'),
    )

    existingResolutions = projectPackageJson.resolutions
      ? { ...projectPackageJson.resolutions }
      : undefined

    projectPackageJson.resolutions ??= {}
    projectPackageJson.resolutions = {
      ...projectPackageJson.resolutions,
      '@cedarjs/auth-dbauth-setup': './cedarjs-auth-dbauth-setup.tgz',
      '@cedarjs/auth-dbauth-api': './cedarjs-auth-dbauth-api.tgz',
      '@cedarjs/auth-dbauth-web': './cedarjs-auth-dbauth-web.tgz',
    }

    fs.writeFileSync(
      projectPackageJsonPath,
      JSON.stringify(projectPackageJson, null, 2),
    )

    // Run `yarn install` to have the resolutions take effect and install the
    // tarballs we copied over
    await exec('yarn install', [], execaOptions)
  }

  await exec(
    'yarn cedar setup auth dbAuth --force --no-webauthn --no-createUserModel --no-generateAuthPages',
    [],
    execaOptions,
  )

  if (localDbAuth) {
    // Restore old resolutions
    if (existingResolutions) {
      projectPackageJson.resolutions = existingResolutions
    }

    fs.writeFileSync(
      projectPackageJsonPath,
      JSON.stringify(projectPackageJson, null, 2),
    )

    // Remove tarballs
    fs.unlinkSync(setupTgzDest)
    fs.unlinkSync(apiTgzDest)
    fs.unlinkSync(webTgzDest)
  }

  // Restore postinstall script
  updatePkgJsonScripts({
    projectPath: outputPath,
    scripts: {
      postinstall: `yarn ${getCfwBin(outputPath)} project:copy`,
    },
  })

  if (linkWithLatestFwBuild) {
    await exec(`yarn ${getCfwBin(outputPath)} project:copy`, [], execaOptions)
  }

  await exec(
    'yarn cedar g dbAuth --no-webauthn --username-label=username --password-label=password',
    [],
    execaOptions,
  )

  // update directive in contacts.sdl.ts
  const pathContactsSdl = `${getOutputPath()}/api/src/graphql/contacts.sdl.ts`
  const contentContactsSdl = fs.readFileSync(pathContactsSdl, 'utf-8')
  const resultsContactsSdl = contentContactsSdl
    .replace(
      'createContact(input: CreateContactInput!): Contact! @requireAuth',
      `createContact(input: CreateContactInput!): Contact @skipAuth`,
    )
    .replace(
      /deleteContact\(id: Int!\): Contact! @requireAuth(?=\s)/,
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
  const usernameFields = contentSignupPageTs.match(
    /\s*<Label[\s\S]*?name="username"[\s\S]*?"rw-field-error" \/>/,
  )?.[0]
  const fullNameFields = usernameFields
    ?.replace(/\s*ref=\{usernameRef}/, '')
    ?.replaceAll('username', 'full-name')
    ?.replaceAll('Username', 'Full Name')

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
