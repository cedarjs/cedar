import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getPaths } from '@cedarjs/project-config'

export function isCedarPgEnabled(): boolean {
  const flag = process.env.CEDAR_PG
  return flag === '1' || flag === 'true'
}

type AcquireIfNeededResult =
  | { status: 'skipped'; reason: 'disabled' }
  | { status: 'skipped'; reason: 'external-url'; databaseUrl: string }
  | {
      status: 'acquired'
      databaseUrl: string
      dispose: () => Promise<void>
    }

type CedarPgModule = {
  acquireIfNeeded: (opts: {
    root?: string
    mode: 'dev' | 'test'
    setEnv?: boolean
    url?: string
    force?: boolean
    disabled?: boolean
  }) => Promise<AcquireIfNeededResult>
  dispose: (opts?: { root?: string; mode?: 'dev' | 'test' }) => Promise<void>
}

function asCedarPgModule(mod: unknown): CedarPgModule {
  if (
    typeof mod === 'object' &&
    mod !== null &&
    typeof Reflect.get(mod, 'acquireIfNeeded') === 'function' &&
    typeof Reflect.get(mod, 'dispose') === 'function'
  ) {
    // Dynamic import of optional app dependency; narrowed above.
    return mod as CedarPgModule
  }
  throw new Error(
    '@cedarjs/pg is installed but does not export acquireIfNeeded/dispose',
  )
}

async function loadCedarPg(root: string): Promise<CedarPgModule> {
  const candidates = [
    path.join(root, 'api', 'package.json'),
    path.join(root, 'package.json'),
  ]
  const errors: string[] = []
  for (const pkgJson of candidates) {
    try {
      const require = createRequire(pkgJson)
      const resolved = require.resolve('@cedarjs/pg')
      const mod = await import(pathToFileURL(resolved).href)
      return asCedarPgModule(mod)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      errors.push(`${pkgJson}: ${message}`)
    }
  }
  throw new Error(
    `Could not resolve @cedarjs/pg from the project. Install it on the api side ` +
      `(yarn cedar setup cedar-pg).\n${errors.join('\n')}`,
  )
}

/** Acquire worktree test DB when CEDAR_PG=1. No-op otherwise. */
export async function acquireCedarPgTest(root?: string): Promise<void> {
  if (!isCedarPgEnabled()) {
    return
  }
  const projectRoot = root ?? getPaths().base
  const cedarPg = await loadCedarPg(projectRoot)
  await cedarPg.acquireIfNeeded({
    root: projectRoot,
    mode: 'test',
    setEnv: true,
    url: process.env.TEST_DATABASE_URL,
    force: process.env.CEDAR_PG_FORCE === '1',
    disabled: false,
  })
}

/** Lease-gated dispose; safe when acquire was skipped. */
export async function disposeCedarPgTest(root?: string): Promise<void> {
  if (!isCedarPgEnabled()) {
    return
  }
  const projectRoot = root ?? getPaths().base
  try {
    const cedarPg = await loadCedarPg(projectRoot)
    await cedarPg.dispose({ root: projectRoot, mode: 'test' })
  } catch {
    // best-effort
  }
}
