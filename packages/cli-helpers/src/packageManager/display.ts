import { getPackageManager } from '@cedarjs/project-config/packageManager'

/**
 * Returns the formatted install command for the detected package manager.
 *
 * yarn → `yarn install`
 * npm  → `npm install`
 * pnpm → `pnpm install`
 */
export function formatInstallCommand(): string {
  return `${getPackageManager()} install`
}

/**
 * Returns a formatted string for running a Cedar CLI command via the detected
 * package manager.
 *
 * npm  → `npx cedar <args>`
 * yarn → `yarn cedar <args>`
 * pnpm → `pnpm cedar <args>`
 */
export function formatCedarCommand(args: string[]): string {
  const pm = getPackageManager()
  const argStr = args.length > 0 ? ` ${args.join(' ')}` : ''

  if (pm === 'npm') {
    return `npx cedar${argStr}`
  }

  return `${pm} cedar${argStr}`
}

/**
 * Returns a formatted string for running a package.json script via the
 * detected package manager.
 *
 * npm  → `npm run <script>[ -- args]`
 * yarn → `yarn <script> [args]`
 * pnpm → `pnpm <script> [args]`
 */
export function formatRunScriptCommand(
  script: string,
  args: string[] = [],
): string {
  const pm = getPackageManager()
  const argStr = args.length > 0 ? ` ${args.join(' ')}` : ''

  if (pm === 'npm') {
    const separator = args.length > 0 ? ' -- ' : ''
    return `npm run ${script}${separator}${args.join(' ')}`
  }

  return `${pm} ${script}${argStr}`
}

/**
 * Returns a formatted string for running a package.json script in a workspace
 * via the detected package manager.
 *
 * yarn → `yarn workspace <workspace> <script> [args]`
 * npm  → `npm run <script> -w <workspace>[ -- args]`
 * pnpm → `pnpm <script> --filter <workspace>[-- args]`
 */
export function formatRunWorkspaceScriptCommand(
  workspace: string,
  script: string,
  args: string[] = [],
): string {
  const pm = getPackageManager()
  const argStr = args.length > 0 ? ` ${args.join(' ')}` : ''

  if (pm === 'yarn') {
    return `yarn workspace ${workspace} ${script}${argStr}`
  }

  if (pm === 'npm') {
    const separator = args.length > 0 ? ' -- ' : ''
    return `npm run ${script} -w ${workspace}${separator}${args.join(' ')}`
  }

  // pnpm
  const separator = args.length > 0 ? ' -- ' : ''
  return `pnpm ${script} --filter ${workspace}${separator}${args.join(' ')}`
}

/**
 * Returns a formatted string for running a local binary (from
 * node_modules/.bin) via the detected package manager.
 *
 * yarn → `yarn <bin> [args]`  (PnP-safe)
 * npm  → `npx <bin> [args]`
 * pnpm → `pnpm exec <bin> [args]`
 */
export function formatRunBinCommand(bin: string, args: string[] = []): string {
  const pm = getPackageManager()
  const argStr = args.length > 0 ? ` ${args.join(' ')}` : ''

  if (pm === 'npm') {
    return `npx ${bin}${argStr}`
  }

  if (pm === 'pnpm') {
    return `pnpm exec ${bin}${argStr}`
  }

  return `yarn ${bin}${argStr}`
}

/**
 * Returns a formatted string for running a transitive dependency's binary
 * (one not listed directly in the project's package.json, e.g. Prisma) via
 * the detected package manager.
 *
 * yarn → `npx <bin> [args]`
 * npm  → `npx <bin> [args]`
 * pnpm → `pnpm exec <bin> [args]`
 */
export function formatRunTransitiveBinCommand(
  bin: string,
  args: string[] = [],
): string {
  const pm = getPackageManager()
  const argStr = args.length > 0 ? ` ${args.join(' ')}` : ''

  if (pm === 'pnpm') {
    return `pnpm exec ${bin}${argStr}`
  }

  return `npx ${bin}${argStr}`
}

/**
 * Returns a formatted string for running a local binary in a workspace context
 * via the detected package manager.
 *
 * yarn → `yarn workspace <workspace> <bin> [args]`
 * npm  → `npm exec -w <workspace> -- <bin> [args]`
 * pnpm → `pnpm exec --filter <workspace> <bin> [args]`
 */
export function formatRunWorkspaceBinCommand(
  workspace: string,
  bin: string,
  args: string[] = [],
): string {
  const pm = getPackageManager()
  const argStr = args.length > 0 ? ` ${args.join(' ')}` : ''

  if (pm === 'yarn') {
    return `yarn workspace ${workspace} ${bin}${argStr}`
  }

  if (pm === 'npm') {
    return `npm exec -w ${workspace} -- ${bin}${argStr}`
  }

  // pnpm
  return `pnpm exec --filter ${workspace} ${bin}${argStr}`
}

/**
 * Returns a formatted string for a one-off package execution via the detected
 * package manager.
 *
 * yarn → `yarn dlx <command> [args]`
 * npm  → `npx <command> [args]`
 * pnpm → `pnpm dlx <command> [args]`
 */
export function formatDlxCommand(command: string, args: string[] = []): string {
  const pm = getPackageManager()
  const argStr = args.length > 0 ? ` ${args.join(' ')}` : ''

  if (pm === 'npm') {
    return `npx ${command}${argStr}`
  }

  return `${pm} dlx ${command}${argStr}`
}

/**
 * Returns a formatted string for adding packages to the project root via the
 * detected package manager.
 *
 * yarn → `yarn add [-D] <packages>`
 * npm  → `npm install [-D] <packages>`
 * pnpm → `pnpm add [-D] <packages>`
 */
export function formatAddRootPackagesCommand(
  packages: string[],
  dev = false,
): string {
  const pm = getPackageManager()
  const devFlag = dev ? ' -D' : ''
  const pkgStr = packages.join(' ')
  const addCmd = pm === 'npm' ? 'install' : 'add'

  return `${pm} ${addCmd}${devFlag} ${pkgStr}`
}

/**
 * Returns a formatted string for adding packages to a workspace via the
 * detected package manager.
 *
 * yarn → `yarn workspace <workspace> add [-D] <packages>`
 * npm  → `npm install [-D] <packages> -w <workspace>`
 * pnpm → `pnpm add [-D] <packages> --filter <workspace>`
 */
export function formatAddWorkspacePackagesCommand(
  workspace: string,
  packages: string[],
  dev = false,
): string {
  const pm = getPackageManager()
  const devFlag = dev ? ' -D' : ''
  const pkgStr = packages.join(' ')

  if (pm === 'yarn') {
    return `yarn workspace ${workspace} add${devFlag} ${pkgStr}`
  }

  if (pm === 'npm') {
    return `npm install${devFlag} ${pkgStr} -w ${workspace}`
  }

  // pnpm
  return `pnpm add${devFlag} ${pkgStr} --filter ${workspace}`
}

/**
 * Returns a formatted string for removing packages from a workspace via the
 * detected package manager.
 *
 * yarn → `yarn workspace <workspace> remove <packages>`
 * npm  → `npm uninstall <packages> -w <workspace>`
 * pnpm → `pnpm remove <packages> --filter <workspace>`
 */
export function formatRemoveWorkspacePackagesCommand(
  workspace: string,
  packages: string[],
): string {
  const pm = getPackageManager()
  const pkgStr = packages.join(' ')

  if (pm === 'yarn') {
    return `yarn workspace ${workspace} remove ${pkgStr}`
  }

  if (pm === 'npm') {
    return `npm uninstall ${pkgStr} -w ${workspace}`
  }

  // pnpm
  return `pnpm remove ${pkgStr} --filter ${workspace}`
}

// Matches values made up only of characters that are never special to a
// POSIX shell, so they can be printed bare.
const SHELL_SAFE_ARG = /^[\w@%+=:,./-]+$/

/**
 * Quotes a single argv value for safe copy-paste into a POSIX shell (e.g.
 * bash, zsh). Values containing only "safe" characters are left bare;
 * anything else is wrapped in single quotes, which suppress all shell
 * expansion (globbing, command substitution, variable expansion, etc.), with
 * any embedded single quotes escaped by closing the quote, emitting an
 * escaped quote, then reopening it. Ported from Python's `shlex.quote`.
 *
 * Like the rest of this module, this targets POSIX shells — it does not
 * produce PowerShell- or cmd.exe-safe output.
 */
export function formatShellArg(arg: string): string {
  if (arg.length > 0 && SHELL_SAFE_ARG.test(arg)) {
    return arg
  }

  return `'${arg.replace(/'/g, `'"'"'`)}'`
}
