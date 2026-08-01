/**
 * Thin bridge to the cedar-pg package for Cedar CLI / testing.
 * Opt-in via CEDAR_PG=1 (or true). Escape-hatch policy lives in cedar-pg
 * (`resolveEnsureSkip`); stale `cpg_*` URLs always re-ensure.
 *
 * Resolves `cedar-pg` from the app's node_modules (api or root), not from
 * @cedarjs/cli's dependencies.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function isCedarPgEnabled(): boolean {
  const flag = process.env.CEDAR_PG
  return flag === '1' || flag === 'true'
}

type EnsureSkip =
  | { skip: false }
  | { skip: true; reason: 'disabled' }
  | { skip: true; reason: 'external-url'; databaseUrl: string }

type CedarPgModule = {
  ensure: (opts: {
    root?: string
    mode: 'dev' | 'test'
    setEnv?: boolean
  }) => Promise<{ databaseUrl: string; dispose: () => Promise<void> }>
  dispose: (opts?: { root?: string; mode?: 'dev' | 'test' }) => Promise<void>
  resolveEnsureSkip: (input?: {
    url?: string
    force?: boolean
    disabled?: boolean
  }) => EnsureSkip
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
      const resolved = require.resolve('cedar-pg')
      return (await import(pathToFileURL(resolved).href)) as CedarPgModule
    } catch (e) {
      errors.push(`${pkgJson}: ${(e as Error).message}`)
    }
  }
  throw new Error(
    `Could not resolve cedar-pg from the project. Install it on the api side ` +
      `(yarn cedar setup cedar-pg).\n${errors.join('\n')}`,
  )
}

function forceFromEnv(): boolean {
  return process.env.CEDAR_PG_FORCE === '1'
}

export async function ensureCedarPgDev(root: string): Promise<string | null> {
  if (!isCedarPgEnabled()) {
    return null
  }

  try {
    const cedarPg = await loadCedarPg(root)
    const skip = cedarPg.resolveEnsureSkip({
      url: process.env.DATABASE_URL,
      force: forceFromEnv(),
      disabled: false,
    })
    if (skip.skip && skip.reason === 'external-url') {
      return skip.databaseUrl
    }

    const result = await cedarPg.ensure({
      root,
      mode: 'dev',
      setEnv: true,
    })
    return result.databaseUrl
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(
      `cedar-pg ensure(dev) failed: ${message}\n` +
        'Install cedar-pg (`yarn cedar setup cedar-pg`) and autopg on the host.',
    )
  }
}

export async function ensureCedarPgTest(root: string): Promise<string | null> {
  if (!isCedarPgEnabled()) {
    return null
  }

  try {
    const cedarPg = await loadCedarPg(root)
    const skip = cedarPg.resolveEnsureSkip({
      url: process.env.TEST_DATABASE_URL,
      force: forceFromEnv(),
      disabled: false,
    })
    if (skip.skip && skip.reason === 'external-url') {
      process.env.DATABASE_URL = skip.databaseUrl
      return skip.databaseUrl
    }

    const result = await cedarPg.ensure({
      root,
      mode: 'test',
      setEnv: true,
    })
    return result.databaseUrl
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(
      `cedar-pg ensure(test) failed: ${message}\n` +
        'Install cedar-pg (`yarn cedar setup cedar-pg`) and autopg on the host.',
    )
  }
}

export async function disposeCedarPgTest(root: string): Promise<void> {
  if (!isCedarPgEnabled()) {
    return
  }
  // dispose() is lease-gated — safe when ensure was skipped via escape hatch
  try {
    const cedarPg = await loadCedarPg(root)
    await cedarPg.dispose({ root, mode: 'test' })
  } catch {
    // best-effort
  }
}
