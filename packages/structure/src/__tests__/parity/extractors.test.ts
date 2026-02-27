import { resolve } from 'node:path'

import { describe, it, expect } from 'vitest'

import { getProject } from '../../index'

describe('Atomic Logic Parity', () => {
  const fixtures = [
    'example-todo-main',
    'test-project',
    'local:structure-test-project',
  ]

  fixtures.forEach((fixtureName) => {
    describe(`Fixture: ${fixtureName}`, () => {
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

      it('correctly identifies a Cell vs a Component', () => {
        const cells = project.cells
        if (cells.length > 0) {
          expect(cells[0].isCell).toBe(true)
        }

        const component = project.components.find(
          (c) => !c.basenameNoExt.endsWith('Cell'),
        )
        if (component) {
          // @ts-expect-error accessing internals for verification
          expect(component.isCell).toBeUndefined()
        }
      })

      it('extracts GraphQL operation names from Cells', () => {
        for (const cell of project.cells) {
          expect(cell.queryOperationName).toBeDefined()
        }
      })

      it('finds all exported functions in services', () => {
        for (const service of project.services) {
          const funcNames = service.funcs.map((f) => f.name)
          expect(funcNames.length).toBeGreaterThan(0)
        }
      })

      it('correctly detects route attributes', () => {
        for (const route of project.router.routes) {
          expect(typeof route.isPrivate).toBe('boolean')
          expect(typeof route.isNotFound).toBe('boolean')
        }
      })
    })
  })
})
