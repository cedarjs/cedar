import { resolve } from 'node:path'

import { describe, it, expect } from 'vitest'

import { getProject } from '../../index'

describe('Error Handling and Edge Cases', () => {
  const projectRootWithErrors = resolve(
    __dirname,
    '../../../../../__fixtures__/example-todo-main-with-errors',
  )
  const projectWithErrors = getProject(projectRootWithErrors)

  it('handles malformed route syntax gracefully', async () => {
    const routes = projectWithErrors.router.routes
    const diagnostics = await projectWithErrors.router.collectDiagnostics()

    // Should still be able to parse other routes
    expect(routes.length).toBeGreaterThan(0)

    // Should capture the syntax error in diagnostics
    expect(
      diagnostics.some((d) =>
        d.diagnostic.message.includes("specify a 'notfound' page"),
      ),
    ).toBe(true)
  })

  it('identifies missing mandatory exports in Cells via exportedSymbols', async () => {
    const cell = projectWithErrors.cells.find(
      (c) => c.basenameNoExt === 'TodoListCell',
    )
    expect(cell).toBeDefined()

    // @ts-expect-error accessing internal exportedSymbols for verification
    const symbols = cell.exportedSymbols

    expect(symbols.has('QUERY')).toBe(true)
    expect(symbols.has('Success')).toBe(true)
    expect(symbols.has('Failure')).toBe(false) // This is missing in the fixture
  })

  it('gracefully handles missing files', () => {
    const project = getProject('/non/existent/path')
    // Should not throw on init
    expect(project.projectRoot).toBe('/non/existent/path')
    // Should return empty arrays for children
    expect(project.pages).toEqual([])
  })
})
