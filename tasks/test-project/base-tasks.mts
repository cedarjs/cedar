import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Options } from 'execa'
import type { ListrTask } from 'listr2'

import {
  applyCodemod,
  fullPath,
  getCfwBin,
  getExecaOptions,
  updatePkgJsonScripts,
  exec,
} from './util.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface CommonTaskOptions {
  outputPath: string
  linkWithLatestFwBuild?: boolean
  isFixture?: boolean
  esmProject?: boolean
  stdio?: Options['stdio']
}

export interface HighLevelTask {
  title: string
  /** Use this to create subtasks */
  tasksGetter?: (
    options: CommonTaskOptions,
  ) => ListrTask[] | Promise<ListrTask[]>
  /** Use this for a single task that doesn't have subtasks */
  task?: (options: CommonTaskOptions) => void | Promise<void> | Promise<unknown>
  enabled?: boolean | ((options: CommonTaskOptions) => boolean)
}

export function createBuilder(cmd: string, dir = '', opts: CommonTaskOptions) {
  return function (positionalArguments?: string | string[]) {
    const execaOptions = {
      ...getExecaOptions(path.join(opts.outputPath, dir)),
      stdio: opts.stdio,
    }

    const args = Array.isArray(positionalArguments)
      ? positionalArguments
      : positionalArguments
        ? [positionalArguments]
        : []

    const subprocess = exec(cmd, args, execaOptions)

    return subprocess
  }
}

export const getWebTasks = (): HighLevelTask[] => {
  return [
    {
      title: 'Creating pages',
      tasksGetter: () => getCreatePagesTasks(),
    },
    {
      title: 'Creating layout',
      tasksGetter: (opts) => getCreateLayoutTasks(opts),
    },
    {
      title: 'Creating components',
      tasksGetter: () => getCreateComponentsTasks(),
    },
    {
      title: 'Creating cells',
      tasksGetter: (opts) => getCreateCellsTasks(opts),
    },
    {
      title: 'Updating cell mocks',
      tasksGetter: (opts) => getUpdateCellMocksTasks(opts),
    },
    {
      title: 'Changing routes',
      task: () => applyCodemod('routes.js', fullPath('web/src/Routes')),
    },
    {
      title: 'Install tailwind dependencies',
      task: (opts) =>
        exec(
          'yarn workspace web add -D postcss postcss-loader tailwindcss autoprefixer prettier-plugin-tailwindcss@^0.5.12',
          [],
          { ...getExecaOptions(opts.outputPath), stdio: opts.stdio },
        ),
      enabled: (opts) => !!opts.linkWithLatestFwBuild,
    },
    {
      title: '[link] Copy local framework files again',
      task: (opts) =>
        exec(`yarn ${getCfwBin(opts.outputPath)} project:copy`, [], {
          ...getExecaOptions(opts.outputPath),
          stdio: opts.stdio,
        }),
      enabled: (opts) => !!opts.linkWithLatestFwBuild,
    },
    {
      title: 'Adding Tailwind',
      task: async (opts) => {
        await exec(
          'yarn cedar setup ui tailwindcss',
          ['--force', opts.linkWithLatestFwBuild && '--no-install'].filter(
            Boolean,
          ) as string[],
          { ...getExecaOptions(opts.outputPath), stdio: opts.stdio },
        )
      },
    },
  ]
}

export async function addModel(outputPath: string, schema: string) {
  const prismaPath = path.join(outputPath, 'api/db/schema.prisma')
  const current = fs.readFileSync(prismaPath, 'utf-8')
  fs.writeFileSync(prismaPath, `${current.trim()}\n\n${schema}\n`)
}

export const getApiTasks = (): HighLevelTask[] => {
  const _addDbAuth = async (opts: CommonTaskOptions) => {
    updatePkgJsonScripts({
      projectPath: opts.outputPath,
      scripts: { postinstall: '' },
    })

    if (opts.isFixture) {
      // Special tarball installation for fixture
      const packages = ['setup', 'api', 'web']
      for (const pkg of packages) {
        const pkgPath = path.join(
          __dirname,
          '../../',
          'packages',
          'auth-providers',
          'dbAuth',
          pkg,
        )
        await exec('yarn build:pack', [], {
          ...getExecaOptions(pkgPath),
          stdio: opts.stdio,
        })
        const tgzDest = path.join(
          opts.outputPath,
          `cedarjs-auth-dbauth-${pkg}.tgz`,
        )
        fs.copyFileSync(
          path.join(pkgPath, `cedarjs-auth-dbauth-${pkg}.tgz`),
          tgzDest,
        )
      }

      const pkgJsonPath = path.join(opts.outputPath, 'package.json')
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
      const oldResolutions = pkgJson.resolutions
      pkgJson.resolutions = {
        ...pkgJson.resolutions,
        '@cedarjs/auth-dbauth-setup': './cedarjs-auth-dbauth-setup.tgz',
        '@cedarjs/auth-dbauth-api': './cedarjs-auth-dbauth-api.tgz',
        '@cedarjs/auth-dbauth-web': './cedarjs-auth-dbauth-web.tgz',
      }
      fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2))

      await exec('yarn install', [], {
        ...getExecaOptions(opts.outputPath),
        stdio: opts.stdio,
      })
      await exec(
        'yarn cedar setup auth dbAuth --force --no-webauthn --no-createUserModel --no-generateAuthPages',
        [],
        { ...getExecaOptions(opts.outputPath), stdio: opts.stdio },
      )

      if (oldResolutions) {
        pkgJson.resolutions = oldResolutions
      } else {
        delete pkgJson.resolutions
      }
      fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2))
    } else {
      const dbAuthSetupPath = path.join(
        opts.outputPath,
        'node_modules',
        '@cedarjs',
        'auth-dbauth-setup',
      )
      fs.rmSync(dbAuthSetupPath, { recursive: true, force: true })

      await exec('yarn cedar setup auth dbAuth --force --no-webauthn', [], {
        ...getExecaOptions(opts.outputPath),
        stdio: opts.stdio,
      })
    }

    updatePkgJsonScripts({
      projectPath: opts.outputPath,
      scripts: {
        postinstall: `yarn ${getCfwBin(opts.outputPath)} project:copy`,
      },
    })

    if (opts.linkWithLatestFwBuild) {
      await exec(`yarn ${getCfwBin(opts.outputPath)} project:copy`, [], {
        ...getExecaOptions(opts.outputPath),
        stdio: opts.stdio,
      })
    }

    await exec(
      'yarn cedar g dbAuth --no-webauthn --username-label=username --password-label=password',
      [],
      { ...getExecaOptions(opts.outputPath), stdio: opts.stdio },
    )

    // Codemods for SDLs
    const pathContactsSdl = path.join(
      opts.outputPath,
      'api/src/graphql/contacts.sdl.ts',
    )
    if (fs.existsSync(pathContactsSdl)) {
      let content = fs.readFileSync(pathContactsSdl, 'utf-8')
      content = content
        .replace(
          'createContact(input: CreateContactInput!): Contact! @requireAuth',
          `createContact(input: CreateContactInput!): Contact @skipAuth`,
        )
        .replace(
          'deleteContact(id: Int!): Contact! @requireAuth',
          'deleteContact(id: Int!): Contact! @requireAuth(roles:["ADMIN"])',
        )
      fs.writeFileSync(pathContactsSdl, content)
    }

    const pathPostsSdl = path.join(
      opts.outputPath,
      'api/src/graphql/posts.sdl.ts',
    )
    if (fs.existsSync(pathPostsSdl)) {
      let content = fs.readFileSync(pathPostsSdl, 'utf-8')
      content = content.replace(
        /posts: \[Post!\]! @requireAuth([^}]*)@requireAuth/,
        `posts: [Post!]! @skipAuth\n      post(id: Int!): Post @skipAuth`,
      )
      fs.writeFileSync(pathPostsSdl, content)
    }

    // Update src/lib/auth to return roles, so tsc doesn't complain
    const libAuthPath = path.join(opts.outputPath, 'api/src/lib/auth.ts')
    if (fs.existsSync(libAuthPath)) {
      let content = fs.readFileSync(libAuthPath, 'utf-8')
      content = content
        .replace(
          'select: { id: true }',
          'select: { id: true, roles: true, email: true}',
        )
        .replace(
          'const currentUserRoles = context.currentUser?.roles',
          'const currentUserRoles = context.currentUser?.roles as string | string[]',
        )
      fs.writeFileSync(libAuthPath, content)
    }

    // update requireAuth test
    const pathRequireAuth = path.join(
      opts.outputPath,
      'api/src/directives/requireAuth/requireAuth.test.ts',
    )
    if (fs.existsSync(pathRequireAuth)) {
      let content = fs.readFileSync(pathRequireAuth, 'utf-8')
      content = content.replace(
        /const mockExecution([^}]*){} }\)/,
        `const mockExecution = mockRedwoodDirective(requireAuth, {
        context: { currentUser: { id: 1, roles: 'ADMIN', email: 'b@zinga.com' } },
      })`,
      )
      fs.writeFileSync(pathRequireAuth, content)
    }

    // add fullName input to signup form
    const pathSignupPageTs = path.join(
      opts.outputPath,
      'web/src/pages/SignupPage/SignupPage.tsx',
    )
    if (fs.existsSync(pathSignupPageTs)) {
      let content = fs.readFileSync(pathSignupPageTs, 'utf-8')
      const usernameFieldsMatch = content.match(
        /\s*<Label[\s\S]*?name="username"[\s\S]*?"rw-field-error" \/>/,
      )
      if (usernameFieldsMatch) {
        const usernameFields = usernameFieldsMatch[0]
        const fullNameFields = usernameFields
          .replace(/\s*ref=\{usernameRef}/, '')
          .replaceAll('username', 'full-name')
          .replaceAll('Username', 'Full Name')

        content = content
          .replace(
            '<FieldError name="password" className="rw-field-error" />',
            '<FieldError name="password" className="rw-field-error" />\n' +
              fullNameFields,
          )
          .replace(
            'password: data.password',
            "password: data.password, 'full-name': data['full-name']",
          )
        fs.writeFileSync(pathSignupPageTs, content)
      }
    }

    // set fullName when signing up
    const pathAuthTs = path.join(opts.outputPath, 'api/src/functions/auth.ts')
    if (fs.existsSync(pathAuthTs)) {
      let content = fs.readFileSync(pathAuthTs, 'utf-8')
      content = content
        .replace('name: string', "'full-name': string")
        .replace('userAttributes: _userAttributes', 'userAttributes')
        .replace(
          '// name: userAttributes.name',
          "fullName: userAttributes['full-name']",
        )
      fs.writeFileSync(pathAuthTs, content)
    }
  }

  return [
    {
      title: 'Adding models to prisma',
      task: async (opts) => {
        const { post, user, contact } = await import('./codemods/models.mjs')
        await addModel(opts.outputPath, post)
        await addModel(opts.outputPath, user)
        if (opts.isFixture) {
          await addModel(opts.outputPath, contact)
          return exec(
            `yarn cedar prisma migrate dev --name create_models`,
            [],
            { ...getExecaOptions(opts.outputPath), stdio: opts.stdio },
          )
        } else {
          return exec(
            `yarn cedar prisma migrate dev --name create_post_user`,
            [],
            { ...getExecaOptions(opts.outputPath), stdio: opts.stdio },
          )
        }
      },
    },
    {
      title: 'Scaffolding post and contacts',
      task: async (opts) => {
        await createBuilder('yarn cedar g scaffold', '', opts)('post')
        await applyCodemod(
          'scenarioValueSuffix.js',
          fullPath('api/src/services/posts/posts.scenarios'),
        )
        if (opts.isFixture) {
          await createBuilder('yarn cedar g scaffold', '', opts)('contacts')
        }
        await exec(`yarn ${getCfwBin(opts.outputPath)} project:copy`, [], {
          ...getExecaOptions(opts.outputPath),
          stdio: opts.stdio,
        })
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
      task: async (opts) => {
        const { contact } = await import('./codemods/models.mjs')
        await addModel(opts.outputPath, contact)
        await exec(`yarn cedar prisma migrate dev --name create_contact`, [], {
          ...getExecaOptions(opts.outputPath),
          stdio: opts.stdio,
        })
        await createBuilder('yarn cedar g scaffold', '', opts)('contacts')

        const contactsServicePath = fullPath(
          'api/src/services/contacts/contacts',
        )
        if (fs.existsSync(contactsServicePath)) {
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
        }
      },
      enabled: (opts) => !!opts.isFixture,
    },
    {
      // This task renames the migration folders so that we don't have to deal with duplicates/conflicts when committing to the repo
      title: 'Adjust dates within migration folder names',
      task: (opts) => {
        const migrationsFolderPath = path.join(
          opts.outputPath,
          'api',
          'db',
          'migrations',
        )
        if (!fs.existsSync(migrationsFolderPath)) {
          return
        }

        // Migration folders are folders which start with 14 digits because they have a yyyymmddhhmmss
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
      task: async (opts) => {
        await createBuilder('yarn cedar g sdl --no-crud', 'api', opts)('user')
        await applyCodemod('usersSdl.js', fullPath('api/src/graphql/users.sdl'))
        await applyCodemod(
          'usersService.js',
          fullPath('api/src/services/users/users'),
        )

        const testPath = fullPath('api/src/services/users/users.test.ts', {
          addExtension: false,
        })
        if (fs.existsSync(testPath)) {
          let content = fs.readFileSync(testPath, 'utf-8')
          content = content.replace(
            "import type { User } from '@prisma/client'",
            '',
          )
          fs.writeFileSync(testPath, content)
        }

        await createBuilder('yarn cedar g types', '', opts)()
      },
      enabled: (opts) => !!opts.isFixture,
    },
    {
      title: 'Add Prerender to Routes',
      tasksGetter: () => getPrerenderTasks(),
    },
    {
      title: 'Add context tests',
      task: (opts) => {
        const templatePath = path.join(
          __dirname,
          'templates',
          'api',
          'context.test.ts.template',
        )
        const projectPath = path.join(
          opts.outputPath,
          'api',
          'src',
          '__tests__',
          'context.test.ts',
        )
        fs.mkdirSync(path.dirname(projectPath), { recursive: true })
        fs.writeFileSync(projectPath, fs.readFileSync(templatePath))
      },
      enabled: (opts) => !!opts.isFixture,
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
          __dirname,
          'templates',
          'api',
          'contacts.describeScenario.test.ts.template',
        )

        fs.copyFileSync(
          describeScenarioFixture,
          fullPath('api/src/services/contacts/describeContacts.test'),
        )
      },
      enabled: (opts) => !!opts.isFixture,
    },
    {
      title: 'Add vitest db import tracking tests for ESM test project',
      task: (opts) => {
        const templatesDir = path.join(__dirname, 'templates', 'api')
        const templatePath1 = path.join(templatesDir, '1-db-import.test.ts')
        const templatePath2 = path.join(templatesDir, '2-db-import.test.ts')
        const templatePath3 = path.join(templatesDir, '3-db-import.test.ts')

        const testsDir = path.join(opts.outputPath, 'api', 'src', '__tests__')
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
          path.join(opts.outputPath, 'api', 'vitest-sort.config.ts'),
        )
      },
      enabled: (opts) => !!opts.esmProject,
    },
  ]
}

export const getCreatePagesTasks = (): ListrTask[] => {
  const createPage = (opts: CommonTaskOptions) =>
    opts.isFixture
      ? createBuilder('yarn cedar g page', 'web', opts)
      : createBuilder('yarn cedar g page', '', opts)

  return [
    {
      title: 'Creating home page',
      task: async (opts) => {
        await createPage(opts)('home /')
        return applyCodemod(
          'homePage.js',
          fullPath('web/src/pages/HomePage/HomePage'),
        )
      },
    },
    {
      title: 'Creating about page',
      task: async (opts) => {
        await createPage(opts)('about')
        return applyCodemod(
          'aboutPage.js',
          fullPath('web/src/pages/AboutPage/AboutPage'),
        )
      },
    },
    {
      title: 'Creating contact page',
      task: async (opts) => {
        await createPage(opts)('contactUs /contact')
        return applyCodemod(
          'contactUsPage.js',
          fullPath('web/src/pages/ContactUsPage/ContactUsPage'),
        )
      },
    },
    {
      title: 'Creating blog post page',
      task: async (opts) => {
        await createPage(opts)('blogPost /blog-post/{id:Int}')
        await applyCodemod(
          'blogPostPage.js',
          fullPath('web/src/pages/BlogPostPage/BlogPostPage'),
        )

        if (opts.isFixture) {
          await applyCodemod(
            'updateBlogPostPageStories.js',
            fullPath('web/src/pages/BlogPostPage/BlogPostPage.stories'),
          )
        }
      },
    },
    {
      title: 'Creating profile page',
      task: async (opts) => {
        await createPage(opts)('profile /profile')

        const testFileContent = `import { render, waitFor, screen } from '@cedarjs/testing/web'
import ProfilePage from './ProfilePage'

describe('ProfilePage', () => {
  it('renders successfully', async () => {
    mockCurrentUser({
      email: 'danny@bazinga.com',
      id: 84849020,
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
          `${path.resolve(__dirname, 'codemods', 'CedarJS.mdx')}`,
        )
        fs.writeFileSync(
          fullPath('web/src/CedarJS.mdx', { addExtension: false }),
          cedarMdxStoryContent,
        )
      },
    },
    {
      title: 'Creating nested cells test page',
      task: async (opts) => {
        await createPage(opts)('waterfall {id:Int}')
        await applyCodemod(
          'waterfallPage.js',
          fullPath('web/src/pages/WaterfallPage/WaterfallPage'),
        )

        if (opts.isFixture) {
          await applyCodemod(
            'updateWaterfallPageStories.js',
            fullPath('web/src/pages/WaterfallPage/WaterfallPage.stories'),
          )
        }
      },
    },
  ]
}

export const getCreateLayoutTasks = (
  _options: CommonTaskOptions,
): ListrTask[] => {
  return [
    {
      title: 'Creating layout',
      task: async (opts) => {
        await createBuilder('yarn cedar g layout', '', opts)('blog')
        return applyCodemod(
          'blogLayout.js',
          fullPath('web/src/layouts/BlogLayout/BlogLayout'),
        )
      },
    },
  ]
}

export const getCreateComponentsTasks = (): ListrTask[] => {
  const tasks: ListrTask[] = [
    {
      title: 'Creating components',
      task: async (opts) => {
        const createComponent = createBuilder(
          'yarn cedar g component',
          '',
          opts,
        )
        await createComponent('blogPost')
        await applyCodemod(
          'blogPost.js',
          fullPath('web/src/components/BlogPost/BlogPost'),
        )

        await createComponent('author')
        await applyCodemod(
          'author.js',
          fullPath('web/src/components/Author/Author'),
        )
        await applyCodemod(
          'updateAuthorStories.js',
          fullPath('web/src/components/Author/Author.stories'),
        )
        await applyCodemod(
          'updateAuthorTest.js',
          fullPath('web/src/components/Author/Author.test'),
        )

        if (opts.isFixture) {
          await createComponent('classWithClassField')
          await applyCodemod(
            'classWithClassField.ts',
            fullPath(
              'web/src/components/ClassWithClassField/ClassWithClassField',
            ),
          )
        }
      },
    },
  ]
  return tasks
}

export const getCreateCellsTasks = (
  _options: CommonTaskOptions,
): ListrTask[] => {
  return [
    {
      title: 'Creating cells',
      task: async (opts) => {
        const createCell = createBuilder('yarn cedar g cell', '', opts)
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
          fullPath(
            'web/src/components/WaterfallBlogPostCell/WaterfallBlogPostCell',
          ),
        )
      },
    },
  ]
}

export const getUpdateCellMocksTasks = (
  _options: CommonTaskOptions,
): ListrTask[] => {
  return [
    {
      title: 'Updating cell mocks',
      task: async () => {
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
            { addExtension: false },
          ),
        )
      },
    },
  ]
}

export const getPrerenderTasks = (): ListrTask[] => {
  return [
    {
      title: 'Creating double rendering test page',
      task: async (opts) => {
        const createPageBuilder = createBuilder('yarn cedar g page', '', opts)
        await createPageBuilder('double')

        const doublePageContent = `import { Metadata } from '@cedarjs/web'
import test from './test.png'

const DoublePage = () => {
  return (
    <>
      <Metadata title="Double" description="Double page" og />
      <h1 className="mb-1 mt-2 text-xl font-semibold">DoublePage</h1>
      <p>This page exists to make sure we don&apos;t regress on RW#7757 and #317</p>
      <img src={test} alt="Test" />
    </>
  )
}
export default DoublePage`

        fs.writeFileSync(
          fullPath('web/src/pages/DoublePage/DoublePage'),
          doublePageContent,
        )
        fs.copyFileSync(
          fullPath('web/public/favicon.png', { addExtension: false }),
          fullPath('web/src/pages/DoublePage/test.png', {
            addExtension: false,
          }),
        )
      },
    },
    {
      title: 'Update Routes.tsx',
      task: () => {
        const pathRoutes = fullPath('web/src/Routes.tsx', {
          addExtension: false,
        })
        let content = fs.readFileSync(pathRoutes, 'utf-8')
        content = content
          .replace(/name="about"/, 'name="about" prerender')
          .replace(/name="home"/, 'name="home" prerender')
          .replace(/name="blogPost"/, 'name="blogPost" prerender')
          .replace(/page={NotFoundPage}/, 'page={NotFoundPage} prerender')
          .replace(/page={WaterfallPage}/, 'page={WaterfallPage} prerender')
          .replace('name="double"', 'name="double" prerender')
          .replace('name="newContact"', 'name="newContact" prerender')
        fs.writeFileSync(pathRoutes, content)

        const blogPostRouteHooks = `import { db } from '$api/src/lib/db.js'
export async function routeParameters() {
  return (await db.post.findMany({ take: 7 })).map((post) => ({ id: post.id }))
}`
        fs.writeFileSync(
          fullPath('web/src/pages/BlogPostPage/BlogPostPage.routeHooks.ts', {
            addExtension: false,
          }),
          blogPostRouteHooks,
        )

        const waterfallRouteHooks = `export async function routeParameters() { return [{ id: 2 }] }`
        fs.writeFileSync(
          fullPath('web/src/pages/WaterfallPage/WaterfallPage.routeHooks.ts', {
            addExtension: false,
          }),
          waterfallRouteHooks,
        )
      },
    },
  ]
}
