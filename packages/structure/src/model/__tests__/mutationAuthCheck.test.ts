import path from 'node:path'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { RWError } from '../../errors.js'
import { DiagnosticSeverity } from '../../x/diagnostics.js'
import { RWProject } from '../RWProject.js'
import type { RWRoute } from '../RWRoute.js'

/**
 * A small, dedicated fixture project (not one of the shared
 * `__fixtures__/` projects at the repo root, which are snapshotted by
 * other packages) exercising the "unprotected route uses a @requireAuth
 * mutation" warning end to end: SDL directives, the route/page/component
 * graph, and the transitive `gql`/`graphql` tag walk.
 */
const fixtureDir = path.resolve(__dirname, '__fixtures__/mutation-auth-check')

let original_CEDAR_CWD: string | undefined

beforeEach(() => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = fixtureDir
})

afterEach(() => {
  if (original_CEDAR_CWD === undefined) {
    delete process.env.CEDAR_CWD
  } else {
    process.env.CEDAR_CWD = original_CEDAR_CWD
  }
})

function getRoute(project: RWProject, name: string): RWRoute {
  const route = project.router.routes.find((r) => r.name === name)
  if (!route) {
    throw new Error(`Could not find route named "${name}"`)
  }
  return route
}

async function findAuthMutationWarning(route: RWRoute) {
  const diagnostics = await route.collectDiagnostics()
  return diagnostics.find(
    (d) =>
      d.diagnostic.code === RWError.UNPROTECTED_ROUTE_USES_AUTH_GATED_MUTATION,
  )
}

describe('RWRoute: unprotected route using a @requireAuth mutation', () => {
  it('warns when an unprotected route directly uses a @requireAuth mutation', async () => {
    const project = new RWProject()
    const route = getRoute(project, 'adminPosts')

    expect(route.isPrivate).toBe(false)

    const warning = await findAuthMutationWarning(route)

    expect(warning).toBeDefined()
    expect(warning?.diagnostic.severity).toBe(DiagnosticSeverity.Warning)
    expect(warning?.diagnostic.message).toContain("Route 'adminPosts'")
    expect(warning?.diagnostic.message).toContain("mutation 'deletePost'")
    expect(warning?.diagnostic.message).toContain(
      path.join('api', 'src', 'graphql', 'posts.sdl.ts'),
    )
    expect(warning?.diagnostic.message).toContain(
      path.join('web', 'src', 'pages', 'AdminPostsPage', 'AdminPostsPage.tsx'),
    )
  })

  it('does not warn when the route is wrapped in a nested <PrivateSet>/<Set>', async () => {
    const project = new RWProject()
    const route = getRoute(project, 'adminPostsProtected')

    expect(route.isPrivate).toBe(true)

    const warning = await findAuthMutationWarning(route)

    expect(warning).toBeUndefined()
  })

  it('warns when the mutation is reached transitively through imported components', async () => {
    const project = new RWProject()
    const route = getRoute(project, 'adminPostsTransitive')

    const warning = await findAuthMutationWarning(route)

    expect(warning).toBeDefined()
    expect(warning?.diagnostic.message).toContain("mutation 'deletePost'")
    expect(warning?.diagnostic.message).toContain(
      path.join(
        'web',
        'src',
        'components',
        'DeletePostButton',
        'DeletePostButton.tsx',
      ),
    )
  })

  it('does not warn for a mutation marked @skipAuth', async () => {
    const project = new RWProject()
    const route = getRoute(project, 'adminPostsSkipAuth')

    const warning = await findAuthMutationWarning(route)

    expect(warning).toBeUndefined()
  })

  it('does not warn for a @requireAuth QUERY on an unprotected page (mutations only)', async () => {
    const project = new RWProject()
    const route = getRoute(project, 'adminPostsQuery')

    const warning = await findAuthMutationWarning(route)

    expect(warning).toBeUndefined()
  })

  it('warns exactly once when a mutation is reached through a component cycle', async () => {
    const project = new RWProject()
    const route = getRoute(project, 'adminPostsCycle')

    const diagnostics = await route.collectDiagnostics()
    const mutationWarnings = diagnostics.filter(
      (d) =>
        d.diagnostic.code ===
        RWError.UNPROTECTED_ROUTE_USES_AUTH_GATED_MUTATION,
    )

    expect(mutationWarnings).toHaveLength(1)
    expect(mutationWarnings[0].diagnostic.message).toContain(
      "mutation 'deletePost'",
    )
  })
})
