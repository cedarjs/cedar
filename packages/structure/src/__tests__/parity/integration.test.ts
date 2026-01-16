import { resolve } from 'node:path'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { getProjectRoutes } from '../../../../internal/src/routes'

describe('Internal Package Integration', () => {
  const projectRoot = resolve(
    __dirname,
    '../../../../../__fixtures__/test-project',
  )
  let originalCwd: string

  beforeAll(() => {
    originalCwd = process.cwd()
    process.chdir(projectRoot)
  })

  afterAll(() => {
    process.chdir(originalCwd)
  })

  it('getProjectRoutes (from @cedarjs/internal) returns correctly mapped routes', () => {
    const routes = getProjectRoutes()
    expect(routes.length).toBeGreaterThan(15)

    const homeRoute = routes.find((r) => r.name === 'home')
    expect(homeRoute).toBeDefined()
    expect(homeRoute?.pathDefinition).toBe('/')
    expect(homeRoute?.filePath).toContain('HomePage')
    expect(homeRoute?.isPrivate).toBe(false)

    const privateRoute = routes.find((r) => r.isPrivate === true)
    expect(privateRoute).toBeDefined()
    expect(privateRoute?.unauthenticated).toBeDefined()
    expect(privateRoute?.name).toEqual('profile')

    const paramRoute = routes.find((r) => r.name === 'editContact')
    expect(paramRoute).toBeDefined()
    expect(paramRoute?.pathDefinition).toBe('/posts/{id:Int}/edit')
    expect(paramRoute?.filePath).toContain('EditPostPage')
    expect(paramRoute?.isPrivate).toBe(false)
    expect(paramRoute?.hasParams).toBe(true)
  })
})
