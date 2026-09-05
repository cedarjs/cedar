import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cedarjs/cli-helpers/packageManager/display', () => ({
  formatCedarCommand: (args: string[] = []) => `yarn cedar ${args.join(' ')}`,
}))

import {
  authNotSetUpMessage,
  hasWebAuthFile,
  noUserModelMessage,
} from '../preflight.js'

const tempDirs: string[] = []

function webSrc({ withAuth }: { withAuth: boolean }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-tenancy-'))
  tempDirs.push(dir)

  if (withAuth) {
    fs.writeFileSync(path.join(dir, 'auth.ts'), 'export const useAuth = {}')
  }

  return dir
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
})

describe('hasWebAuthFile', () => {
  it('is false for a project that never set up auth', () => {
    expect(hasWebAuthFile(webSrc({ withAuth: false }))).toBe(false)
  })

  it('is true once a provider has written web/src/auth', () => {
    expect(hasWebAuthFile(webSrc({ withAuth: true }))).toBe(true)
  })

  it('recognises the file whichever extension the provider wrote', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-tenancy-'))
    tempDirs.push(dir)
    // Clerk writes `auth.tsx`, the other providers write `auth.ts`.
    fs.writeFileSync(path.join(dir, 'auth.tsx'), 'export const useAuth = {}')

    expect(hasWebAuthFile(dir)).toBe(true)
  })
})

describe('the messages', () => {
  it('points at the auth setup command when auth is missing', () => {
    expect(authNotSetUpMessage()).toContain('Auth is not set up')
    expect(authNotSetUpMessage()).toContain('setup auth dbAuth')
  })

  it('names the schema and shows a model to copy when User is missing', () => {
    const message = noUserModelMessage('api/db/schema.prisma')

    expect(message).toContain('No `User` model found in api/db/schema.prisma')
    expect(message).toContain('model User {')
  })
})
