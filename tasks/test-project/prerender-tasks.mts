import fs from 'node:fs'

import { createBuilder, fullPath, getOutputPath } from './base-tasks.mts'

export function getPrerenderTasks() {
  return [
    {
      // We need to do this here, and not where we create the other pages, to
      // keep it outside of BlogLayout
      title: 'Creating double rendering test page',
      task: async () => {
        const createPage = createBuilder('yarn cedar g page')
        await createPage('double')

        const doublePageContent = `import { Metadata } from '@cedarjs/web'

          import test from './test.png'

          const DoublePage = () => {
            return (
              <>
                <Metadata title="Double" description="Double page" og />

                <h1 className="mb-1 mt-2 text-xl font-semibold">DoublePage</h1>
                <p>
                  This page exists to make sure we don&apos;t regress on{' '}
                  <a
                    href="https://github.com/redwoodjs/redwood/issues/7757"
                    className="text-blue-600 underline visited:text-purple-600 hover:text-blue-800"
                    target="_blank"
                    rel="noreferrer"
                  >
                    #7757
                  </a>
                </p>
                <p>For RW#7757 it needs to be a page that is not wrapped in a Set</p>
                <p>
                  We also use this page to make sure we don&apos;t regress on{' '}
                  <a
                    href="https://github.com/cedarjs/cedar/issues/317"
                    className="text-blue-600 underline visited:text-purple-600 hover:text-blue-800"
                    target="_blank"
                    rel="noreferrer"
                  >
                    #317
                  </a>
                </p>
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
        const pathRoutes = `${getOutputPath()}/web/src/Routes.tsx`
        const contentRoutes = fs.readFileSync(pathRoutes).toString()
        const resultsRoutesAbout = contentRoutes.replace(
          /name="about"/,
          `name="about" prerender`,
        )
        const resultsRoutesHome = resultsRoutesAbout.replace(
          /name="home"/,
          `name="home" prerender`,
        )
        const resultsRoutesBlogPost = resultsRoutesHome.replace(
          /name="blogPost"/,
          `name="blogPost" prerender`,
        )
        const resultsRoutesNotFound = resultsRoutesBlogPost.replace(
          /page={NotFoundPage}/,
          `page={NotFoundPage} prerender`,
        )
        const resultsRoutesWaterfall = resultsRoutesNotFound.replace(
          /page={WaterfallPage}/,
          `page={WaterfallPage} prerender`,
        )
        const resultsRoutesDouble = resultsRoutesWaterfall.replace(
          'name="double"',
          'name="double" prerender',
        )
        const resultsRoutesNewContact = resultsRoutesDouble.replace(
          'name="newContact"',
          'name="newContact" prerender',
        )
        fs.writeFileSync(pathRoutes, resultsRoutesNewContact)

        const blogPostRouteHooks = `import { db } from '$api/src/lib/db.js'

          export async function routeParameters() {
            return (await db.post.findMany({ take: 7 })).map((post) => ({ id: post.id }))
          }`
        const blogPostRouteHooksPath = `${getOutputPath()}/web/src/pages/BlogPostPage/BlogPostPage.routeHooks.ts`
        fs.writeFileSync(blogPostRouteHooksPath, blogPostRouteHooks)

        const waterfallRouteHooks = `export async function routeParameters() {
            return [{ id: 2 }]
          }`
        const waterfallRouteHooksPath = `${getOutputPath()}/web/src/pages/WaterfallPage/WaterfallPage.routeHooks.ts`
        fs.writeFileSync(waterfallRouteHooksPath, waterfallRouteHooks)
      },
    },
  ]
}
