import { expect } from '@playwright/test'
import type { PlaywrightTestArgs } from '@playwright/test'

/**
 * Tests Cell query aggregation: AggregatedBlogPostCell spreads the FRAGMENT
 * that AuthorFragmentCell declares, so one single GraphQL request must fetch
 * both the blog post and its author
 */
export async function aggregatedCellsTest({ page }: PlaywrightTestArgs) {
  const graphqlRequestBodies: string[] = []

  page.on('request', (request) => {
    if (request.url().includes('graphql') && request.method() === 'POST') {
      graphqlRequestBodies.push(request.postData() ?? '')
    }
  })

  await page.goto('/aggregated-blog-post/1')

  // The blog post itself is rendered by AggregatedBlogPostCell
  await expect(page.locator('.aggregated-blog-post h2')).not.toBeEmpty()

  // The author details are rendered by AuthorFragmentCell, which reads its
  // slice of the aggregated query result through the `_ref` prop
  await expect(page.locator('.author-fragment-cell')).toContainText(
    '@example.com',
  )

  const aggregatedQueries = graphqlRequestBodies.filter((body) =>
    body.includes('FindAggregatedBlogPostQuery'),
  )

  // A single request must fetch both the post and its author...
  expect(aggregatedQueries).toHaveLength(1)

  // ...with the fragment cell's data requirements inlined into the query
  expect(aggregatedQueries[0]).toContain('fragment AuthorFragmentCell_author')

  // ...and the author must not be fetched with a separate query (that's what
  // the waterfall page does)
  const authorQueries = graphqlRequestBodies.filter((body) =>
    body.includes('FindAuthorQuery'),
  )
  expect(authorQueries).toHaveLength(0)
}
