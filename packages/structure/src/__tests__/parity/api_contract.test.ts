import { resolve } from 'node:path'

import { describe, it, expect } from 'vitest'

import { getProject } from '../../index'

describe('API Contract (Public API stability)', () => {
  const projectRoot = resolve(
    __dirname,
    '../../../../../__fixtures__/example-todo-main',
  )
  const project = getProject(projectRoot)

  it('RWProject has expected top-level accessors', () => {
    expect(project).toHaveProperty('pages')
    expect(project).toHaveProperty('router')
    expect(project).toHaveProperty('services')
    expect(project).toHaveProperty('cells')
    expect(project).toHaveProperty('layouts')
    expect(Array.isArray(project.pages)).toBe(true)
  })

  it('RWRouter and RWRoute have expected properties', () => {
    const router = project.router
    expect(router).toHaveProperty('routes')
    expect(Array.isArray(router.routes)).toBe(true)

    const route = router.routes[0]
    expect(route).toHaveProperty('name')
    expect(route).toHaveProperty('path')
    expect(route).toHaveProperty('page')
    expect(route).toHaveProperty('isPrivate')
    expect(route).toHaveProperty('isNotFound')
    expect(route).toHaveProperty('page_identifier_str')
    // Important for Internal/Vite
    expect(typeof route.isPrivate).toBe('boolean')
  })

  it('RWPage has expected properties', () => {
    const page = project.pages[0]
    expect(page).toHaveProperty('constName')
    expect(page).toHaveProperty('path') // This is the file path
    expect(typeof page.constName).toBe('string')
    expect(typeof page.path).toBe('string')
  })

  it('RWCell has expected properties', () => {
    const cell = project.cells[0]
    expect(cell).toHaveProperty('queryOperationName')
    expect(cell).toHaveProperty('isCell')
    expect(typeof cell.isCell).toBe('boolean')
  })

  it('RWService has expected properties', () => {
    const service = project.services[0]
    expect(service).toHaveProperty('name')
    expect(service).toHaveProperty('funcs')
    expect(Array.isArray(service.funcs)).toBe(true)

    const func = service.funcs[0]
    expect(func).toHaveProperty('name')
    expect(func).toHaveProperty('parameterNames')
  })
})
