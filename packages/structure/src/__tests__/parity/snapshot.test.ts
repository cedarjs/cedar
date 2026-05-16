import { resolve } from 'node:path'

import { describe, it, expect } from 'vitest'

import { getProject } from '../../index'

describe('Project Serialization Parity', () => {
  const fixtures = [
    'example-todo-main',
    'test-project',
    'local:structure-test-project',
  ]

  fixtures.forEach((fixtureName) => {
    it(`serializes ${fixtureName} correctly`, async () => {
      let projectRoot: string
      if (fixtureName.startsWith('local:')) {
        projectRoot = resolve(
          __dirname,
          '__fixtures__',
          fixtureName.replace('local:', ''),
        )
      } else {
        projectRoot = resolve(
          __dirname,
          '../../../../../__fixtures__',
          fixtureName,
        )
      }

      const project = getProject(projectRoot)

      // Helper to strip absolute paths from snapshots to make them portable
      const cleanPath = (p: string | undefined) => p?.replace(projectRoot, '')

      const snapshot = {
        pages: project.pages.map((p) => ({
          constName: p.constName,
          path: cleanPath(p.path),
        })),
        router: {
          routes: project.router.routes.map((r) => ({
            name: r.name,
            path: r.path,
            pageIdentifier: r.page_identifier_str,
            isPrivate: r.isPrivate,
            isNotFound: r.isNotFound,
            prerender: r.prerender,
            redirect: r.redirect,
          })),
        },
        services: project.services.map((s) => ({
          name: s.name,
          functions: s.funcs.map((f) => ({
            name: f.name,
            parameters: f.parameterNames,
          })),
        })),
        cells: project.cells.map((c) => ({
          name: c.basenameNoExt,
          queryOperationName: c.queryOperationName,
        })),
        layouts: project.layouts.map((l) => ({
          name: l.basenameNoExt,
        })),
      }

      expect(snapshot).toMatchSnapshot()
    })
  })
})
