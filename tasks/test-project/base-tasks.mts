import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ListrTask } from 'listr2'

import {
  applyCodemod,
  createBuilder,
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

export const getWebTasks = (options: CommonTaskOptions): HighLevelTask[] => {
  return [
    {
      title: 'Creating pages',
      tasksGetter: (opts) => getCreatePagesTasks(opts),
    },
    {
      title: 'Creating layout',
      tasksGetter: (opts) => getCreateLayoutTasks(opts),
    },
    {
      title: 'Creating components',
      tasksGetter: (opts) => getCreateComponentsTasks(opts),
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
      task: () =>
        exec(
          'yarn workspace web add -D postcss postcss-loader tailwindcss autoprefixer prettier-plugin-tailwindcss@^0.5.12',
          [],
          getExecaOptions(options.outputPath),
        ),
      enabled: (opts) => !!opts.linkWithLatestFwBuild,
    },
    {
      title: '[link] Copy local framework files again',
      task: () =>
        exec(
          `yarn ${getCfwBin(options.outputPath)} project:copy`,
          [],
          getExecaOptions(options.outputPath),
        ),
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
          getExecaOptions(opts.outputPath),
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

export const getApiTasks = (options: CommonTaskOptions): HighLevelTask[] => {
  const addDbAuth = async () => {
    updatePkgJsonScripts({
      projectPath: options.outputPath,
      scripts: { postinstall: '' },
    })

    if (options.isFixture) {
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
        await exec('yarn build:pack', [], getExecaOptions(pkgPath))
        const tgzDest = path.join(
          options.outputPath,
          `cedarjs-auth-dbauth-${pkg}.tgz`,
        )
        fs.copyFileSync(
          path.join(pkgPath, `cedarjs-auth-dbauth-${pkg}.tgz`),
          tgzDest,
        )
      }

      const pkgJsonPath = path.join(options.outputPath, 'package.json')
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
      const oldResolutions = pkgJson.resolutions
      pkgJson.resolutions = {
        ...pkgJson.resolutions,
        '@cedarjs/auth-dbauth-setup': './cedarjs-auth-dbauth-setup.tgz',
        '@cedarjs/auth-dbauth-api': './cedarjs-auth-dbauth-api.tgz',
        '@cedarjs/auth-dbauth-web': './cedarjs-auth-dbauth-web.tgz',
      }
      fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2))

      await exec('yarn install', [], getExecaOptions(options.outputPath))
      await exec(
        'yarn cedar setup auth dbAuth --force --no-webauthn --no-createUserModel --no-generateAuthPages',
        [],
        getExecaOptions(options.outputPath),
      )

      if (oldResolutions) {
        pkgJson.resolutions = oldResolutions
      } else {
        delete pkgJson.resolutions
      }
      fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2))
    } else {
      const dbAuthSetupPath = path.join(
        options.outputPath,
        'node_modules',
        '@cedarjs',
        'auth-dbauth-setup',
      )
      fs.rmSync(dbAuthSetupPath, { recursive: true, force: true })

      await exec(
        'yarn cedar setup auth dbAuth --force --no-webauthn',
        [],
        getExecaOptions(options.outputPath),
      )
    }

    updatePkgJsonScripts({
      projectPath: options.outputPath,
      scripts: {
        postinstall: `yarn ${getCfwBin(options.outputPath)} project:copy`,
      },
    })

    if (options.linkWithLatestFwBuild) {
      await exec(
        `yarn ${getCfwBin(options.outputPath)} project:copy`,
        [],
        getExecaOptions(options.outputPath),
      )
    }

    await exec(
      'yarn cedar g dbAuth --no-webauthn --username-label=username --password-label=password',
      [],
      getExecaOptions(options.outputPath),
    )

    // Codemods for SDLs
    const pathContactsSdl = path.join(
      options.outputPath,
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
      options.outputPath,
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
  }

  return [
    {
      title: 'Adding models to prisma',
      task: async () => {
        const { post, user, contact } = await import('./codemods/models.mjs')
        await addModel(options.outputPath, post)
        await addModel(options.outputPath, user)
        if (options.isFixture) {
          await addModel(options.outputPath, contact)
          return exec(
            `yarn cedar prisma migrate dev --name create_models`,
            [],
            getExecaOptions(options.outputPath),
          )
        } else {
          return exec(
            `yarn cedar prisma migrate dev --name create_post_user`,
            [],
            getExecaOptions(options.outputPath),
          )
        }
      },
    },
    {
      title: 'Scaffolding post and contacts',
      task: async () => {
        await createBuilder('yarn cedar g scaffold')('post')
        await applyCodemod(
          'scenarioValueSuffix.js',
          fullPath('api/src/services/posts/posts.scenarios'),
        )
        if (options.isFixture) {
          await createBuilder('yarn cedar g scaffold')('contacts')
        }
        await exec(
          `yarn ${getCfwBin(options.outputPath)} project:copy`,
          [],
          getExecaOptions(options.outputPath),
        )
      },
    },
    {
      title: 'Add dbAuth',
      task: async () => addDbAuth(),
    },
    {
      title: 'Add users service',
      task: async () => {
        await createBuilder('yarn cedar g sdl --no-crud', 'api')('user')
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

        await createBuilder('yarn cedar g types')()
      },
      // Assuming this is also for fixture mainly, or generally useful?
      // tui-tasks.mts had it. tasks.mts did not.
      // I'll enable it for fixture for now, or maybe always if safe?
      // "usersSdl.js" codemod exists? tui-tasks.mts used it.
      enabled: (opts) => !!opts.isFixture,
    },
    {
      title: 'Add Prerender to Routes',
      tasksGetter: (opts) => getPrerenderTasks(opts),
    },
    {
      title: 'Add context tests',
      task: () => {
        const templatePath = path.join(
          __dirname,
          'templates',
          'api',
          'context.test.ts.template',
        )
        const projectPath = path.join(
          options.outputPath,
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
  ]
}

export const getCreatePagesTasks = (
  options: CommonTaskOptions,
): ListrTask[] => {
  const createPage = options.isFixture
    ? createBuilder('yarn cedar g page', 'web')
    : createBuilder('yarn cedar g page')

  return [
    {
      title: 'Creating home page',
      task: async () => {
        await createPage('home /')
        return applyCodemod(
          'homePage.js',
          fullPath('web/src/pages/HomePage/HomePage'),
        )
      },
    },
    {
      title: 'Creating about page',
      task: async () => {
        await createPage('about')
        return applyCodemod(
          'aboutPage.js',
          fullPath('web/src/pages/AboutPage/AboutPage'),
        )
      },
    },
    {
      title: 'Creating contact page',
      task: async () => {
        await createPage('contactUs /contact')
        return applyCodemod(
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

        if (options.isFixture) {
          await applyCodemod(
            'updateBlogPostPageStories.js',
            fullPath('web/src/pages/BlogPostPage/BlogPostPage.stories'),
          )
        }
      },
    },
    {
      title: 'Creating profile page',
      task: async () => {
        await createPage('profile /profile')

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
})`

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
      task: async () => {
        await createPage('waterfall {id:Int}')
        await applyCodemod(
          'waterfallPage.js',
          fullPath('web/src/pages/WaterfallPage/WaterfallPage'),
        )

        if (options.isFixture) {
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
  const createLayoutBuilder = createBuilder('yarn cedar g layout')
  return [
    {
      title: 'Creating layout',
      task: async () => {
        await createLayoutBuilder('blog')
        return applyCodemod(
          'blogLayout.js',
          fullPath('web/src/layouts/BlogLayout/BlogLayout'),
        )
      },
    },
  ]
}

export const getCreateComponentsTasks = (
  options: CommonTaskOptions,
): ListrTask[] => {
  const createComponent = createBuilder('yarn cedar g component')
  const tasks: ListrTask[] = [
    {
      title: 'Creating components',
      task: async () => {
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

        if (options.isFixture) {
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
  const createCell = createBuilder('yarn cedar g cell')
  return [
    {
      title: 'Creating cells',
      task: async () => {
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

export const getPrerenderTasks = (options: CommonTaskOptions): ListrTask[] => {
  return [
    {
      title: 'Creating double rendering test page',
      task: async () => {
        const createPageBuilder = createBuilder('yarn cedar g page')
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
