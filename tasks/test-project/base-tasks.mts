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
  setOutputPath,
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
          'homePage.mjs',
          fullPath('web/src/pages/HomePage/HomePage'),
        )
      },
    },
    {
      title: 'Creating about page',
      task: async () => {
        await createPage('about')
        return applyCodemod(
          'aboutPage.mjs',
          fullPath('web/src/pages/AboutPage/AboutPage'),
        )
      },
    },
    {
      title: 'Creating contact page',
      task: async () => {
        await createPage('contactUs /contact')
        return applyCodemod(
          'contactUsPage.mjs',
          fullPath('web/src/pages/ContactUsPage/ContactUsPage'),
        )
      },
    },
    {
      title: 'Creating blog post page',
      task: async () => {
        await createPage('blogPost /blog-post/{id:Int}')
        await applyCodemod(
          'blogPostPage.mjs',
          fullPath('web/src/pages/BlogPostPage/BlogPostPage'),
        )

        if (options.isFixture) {
          await applyCodemod(
            'updateBlogPostPageStories.mjs',
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
          'profilePage.mjs',
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
          'waterfallPage.mjs',
          fullPath('web/src/pages/WaterfallPage/WaterfallPage'),
        )

        if (options.isFixture) {
          await applyCodemod(
            'updateWaterfallPageStories.mjs',
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
          'blogLayout.mjs',
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
          'blogPost.mjs',
          fullPath('web/src/components/BlogPost/BlogPost'),
        )

        await createComponent('author')
        await applyCodemod(
          'author.mjs',
          fullPath('web/src/components/Author/Author'),
        )
        await applyCodemod(
          'updateAuthorStories.mjs',
          fullPath('web/src/components/Author/Author.stories'),
        )
        await applyCodemod(
          'updateAuthorTest.mjs',
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
          'blogPostsCell.mjs',
          fullPath('web/src/components/BlogPostsCell/BlogPostsCell'),
        )

        await createCell('blogPost')
        await applyCodemod(
          'blogPostCell.mjs',
          fullPath('web/src/components/BlogPostCell/BlogPostCell'),
        )

        await createCell('author')
        await applyCodemod(
          'authorCell.mjs',
          fullPath('web/src/components/AuthorCell/AuthorCell'),
        )

        await createCell('waterfallBlogPost')
        return applyCodemod(
          'waterfallBlogPostCell.mjs',
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
          'updateBlogPostMocks.mjs',
          fullPath('web/src/components/BlogPostCell/BlogPostCell.mock.ts', {
            addExtension: false,
          }),
        )
        await applyCodemod(
          'updateBlogPostMocks.mjs',
          fullPath('web/src/components/BlogPostsCell/BlogPostsCell.mock.ts', {
            addExtension: false,
          }),
        )
        await applyCodemod(
          'updateAuthorCellMock.mjs',
          fullPath('web/src/components/AuthorCell/AuthorCell.mock.ts', {
            addExtension: false,
          }),
        )
        return applyCodemod(
          'updateWaterfallBlogPostMocks.mjs',
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
      <p>This page exists to make sure we don't regress on RW#7757 and #317</p>
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

        const blogPostRouteHooks = `import { db } from '$api/src/lib/db.mjs'
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
