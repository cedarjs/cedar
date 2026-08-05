/**
 * Thin bridge to @cedarjs/pg for Cedar CLI / testing.
 * Opt-in via CEDAR_PG=1 (or true). Lifecycle + escape-hatch policy live in
 * @cedarjs/pg (`acquireIfNeeded`); stale `cpg_*` URLs always re-acquire.
 *
 * Resolves `@cedarjs/pg` from the app's node_modules (api or root), not from
 * @cedarjs/cli's dependencies.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

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
      return (await import(pathToFileURL(resolved).href)) as CedarPgModule
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

function forceFromEnv(): boolean {
  return process.env.CEDAR_PG_FORCE === '1'
}

function databaseUrlFrom(result: AcquireIfNeededResult): string | null {
  if (result.status === 'acquired') {
    return result.databaseUrl
  }
  if (result.status === 'skipped' && result.reason === 'external-url') {
    return result.databaseUrl
  }
  return null
}

export async function acquireCedarPgDev(root: string): Promise<string | null> {
  if (!isCedarPgEnabled()) {
    return null
  }

  try {
    const cedarPg = await loadCedarPg(root)
    const result = await cedarPg.acquireIfNeeded({
      root,
      mode: 'dev',
      setEnv: true,
      url: process.env.DATABASE_URL,
      force: forceFromEnv(),
      disabled: false,
    })
    return databaseUrlFrom(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(
      `@cedarjs/pg acquire(dev) failed: ${message}\n` +
        'Install @cedarjs/pg (`yarn cedar setup cedar-pg`) and autopg on the host.',
    )
  }
}

export async function acquireCedarPgTest(root: string): Promise<string | null> {
  if (!isCedarPgEnabled()) {
    return null
  }

  try {
    const cedarPg = await loadCedarPg(root)
    const result = await cedarPg.acquireIfNeeded({
      root,
      mode: 'test',
      setEnv: true,
      url: process.env.TEST_DATABASE_URL,
      force: forceFromEnv(),
      disabled: false,
    })
    return databaseUrlFrom(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(
      `@cedarjs/pg acquire(test) failed: ${message}\n` +
        'Install @cedarjs/pg (`yarn cedar setup cedar-pg`) and autopg on the host.',
    )
  }
}

export async function disposeCedarPgTest(root: string): Promise<void> {
  if (!isCedarPgEnabled()) {
    return
  }
  // dispose() is lease-gated — safe when acquire was skipped via escape hatch
  try {
    const cedarPg = await loadCedarPg(root)
    await cedarPg.dispose({ root, mode: 'test' })
  } catch {
    // best-effort
  }
}
