/**
 * Thin bridge to @cedarjs/pg for `cedar dev`. Opt-in via CEDAR_PG=1|true.
 * Resolves the package from the app's node_modules (api or root).
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function isCedarPgEnabled(): boolean {
  const flag = process.env.CEDAR_PG
  return flag === '1' || flag === 'true'
}

type AcquireIfNeededResult = {
  status: 'acquired' | 'skipped'
  reason?: string
}

type AcquireIfNeeded = (opts: {
  root?: string
  mode: 'dev' | 'test'
  setEnv?: boolean
  url?: string
  force?: boolean
  disabled?: boolean
}) => Promise<AcquireIfNeededResult>

function asAcquireIfNeeded(mod: unknown): AcquireIfNeeded {
  if (typeof mod !== 'object' || mod === null) {
    throw new Error(
      '@cedarjs/pg is installed but does not export acquireIfNeeded',
    )
  }
  const fn = Reflect.get(mod, 'acquireIfNeeded')
  if (typeof fn !== 'function') {
    throw new Error(
      '@cedarjs/pg is installed but does not export acquireIfNeeded',
    )
  }
  // Optional app dependency; narrowed to a function above.
  return fn as AcquireIfNeeded
}

async function loadAcquireIfNeeded(root: string): Promise<AcquireIfNeeded> {
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
      return asAcquireIfNeeded(mod)
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

/** Returns true when a worktree DATABASE_URL is ready (acquired or external escape hatch). */
export async function acquireCedarPgDev(root: string): Promise<boolean> {
  if (!isCedarPgEnabled()) {
    return false
  }

  try {
    const acquireIfNeeded = await loadAcquireIfNeeded(root)
    const result = await acquireIfNeeded({
      root,
      mode: 'dev',
      setEnv: true,
      url: process.env.DATABASE_URL,
      force: process.env.CEDAR_PG_FORCE === '1',
      disabled: false,
    })
    return (
      result.status === 'acquired' ||
      (result.status === 'skipped' && result.reason === 'external-url')
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(
      `@cedarjs/pg acquire(dev) failed: ${message}\n` +
        'Install @cedarjs/pg (`yarn cedar setup cedar-pg`) and autopg on the host.',
    )
  }
}
