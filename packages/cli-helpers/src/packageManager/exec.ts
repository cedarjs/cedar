import execa from 'execa'
import type {
  Options as ExecaOptions,
  SyncOptions as ExecaSyncOptions,
} from 'execa'

import { getPackageManager } from '@cedarjs/project-config/packageManager'

/**
 * Run a script defined in package.json "scripts".
 *
 * - yarn:  `yarn <script> [args]`
 * - npm:   `npm run <script> [-- args]`
 * - pnpm:  `pnpm <script> [args]`
 */
export function runScript(
  script: string,
  args: string[] = [],
  options?: ExecaOptions,
) {
  const pm = getPackageManager()

  if (pm === 'npm') {
    const npmArgs =
      args.length > 0 ? ['run', script, '--', ...args] : ['run', script]
    return execa(pm, npmArgs, options)
  }

  return execa(pm, [script, ...args], options)
}

/**
 * Synchronous variant of {@link runScript}.
 */
export function runScriptSync(
  script: string,
  args: string[] = [],
  options?: ExecaSyncOptions,
) {
  const pm = getPackageManager()

  if (pm === 'npm') {
    const npmArgs =
      args.length > 0 ? ['run', script, '--', ...args] : ['run', script]
    return execa.sync(pm, npmArgs, options)
  }

  return execa.sync(pm, [script, ...args], options)
}

/**
 * Run a script in a workspace.
 *
 * - yarn:  `yarn workspace <workspace> <script> [args]`
 * - npm:   `npm run <script> -w <workspace> [-- args]`
 * - pnpm:  `pnpm <script> --filter <workspace> [args]`
 */
export function runWorkspaceScript(
  workspace: string,
  script: string,
  args: string[] = [],
  options?: ExecaOptions,
) {
  const pm = getPackageManager()

  if (pm === 'yarn') {
    return execa(pm, ['workspace', workspace, script, ...args], options)
  }

  if (pm === 'npm') {
    const npmArgs =
      args.length > 0
        ? ['run', script, '-w', workspace, '--', ...args]
        : ['run', script, '-w', workspace]
    return execa(pm, npmArgs, options)
  }

  // pnpm
  return execa(pm, [script, '--filter', workspace, ...args], options)
}

/**
 * Run a local binary from node_modules/.bin (PnP-safe for Yarn).
 *
 * - yarn:  `yarn <bin> [args]`
 * - npm:   `npx <bin> [args]`
 * - pnpm:  `pnpm exec <bin> [args]`
 */
export function runBin(
  bin: string,
  args: string[] = [],
  options?: ExecaOptions,
) {
  const pm = getPackageManager()

  if (pm === 'npm') {
    return execa('npx', [bin, ...args], options)
  }

  if (pm === 'pnpm') {
    return execa(pm, ['exec', bin, ...args], options)
  }

  // yarn
  return execa(pm, [bin, ...args], options)
}

/**
 * Synchronous variant of {@link runBin}.
 */
export function runBinSync(
  bin: string,
  args: string[] = [],
  options?: ExecaSyncOptions,
) {
  const pm = getPackageManager()

  if (pm === 'npm') {
    return execa.sync('npx', [bin, ...args], options)
  }

  if (pm === 'pnpm') {
    return execa.sync(pm, ['exec', bin, ...args], options)
  }

  // yarn
  return execa.sync(pm, [bin, ...args], options)
}

/**
 * Run a local binary in a workspace context.
 *
 * - yarn:  `yarn workspace <workspace> <bin> [args]`
 * - npm:   `npm exec -w <workspace> -- <bin> [args]`
 * - pnpm:  `pnpm exec --filter <workspace> <bin> [args]`
 */
export function runWorkspaceBin(
  workspace: string,
  bin: string,
  args: string[] = [],
  options?: ExecaOptions,
) {
  const pm = getPackageManager()

  if (pm === 'yarn') {
    return execa(pm, ['workspace', workspace, bin, ...args], options)
  }

  if (pm === 'npm') {
    return execa(pm, ['exec', '-w', workspace, '--', bin, ...args], options)
  }

  // pnpm
  return execa(pm, ['exec', '--filter', workspace, bin, ...args], options)
}

/**
 * One-off package execution (equivalent to `npx`).
 *
 * - yarn:  `yarn dlx <command> [args]`
 * - npm:   `npx <command> [args]`
 * - pnpm:  `pnpm dlx <command> [args]`
 */
export function dlx(
  command: string,
  args: string[] = [],
  options?: ExecaOptions,
) {
  const pm = getPackageManager()

  if (pm === 'npm') {
    return execa('npx', [command, ...args], options)
  }

  return execa(pm, ['dlx', command, ...args], options)
}
