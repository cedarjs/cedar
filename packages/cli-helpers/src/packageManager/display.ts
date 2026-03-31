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
 * yarn → `yarn cedar <args>`
 * npm  → `npx cedar <args>`
 * pnpm → `pnpm exec cedar <args>`
 */
export function formatCedarCommand(args: string[]): string {
  const pm = getPackageManager()
  const argStr = args.length > 0 ? ` ${args.join(' ')}` : ''

  if (pm === 'npm') {
    return `npx cedar${argStr}`
  }

  if (pm === 'pnpm') {
    return `pnpm exec cedar${argStr}`
  }

  return `yarn cedar${argStr}`
}

/**
 * Returns a formatted string for running a package.json script via the
 * detected package manager.
 *
 * yarn → `yarn <script> [args]`
 * npm  → `npm run <script>[ -- args]`
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
 * pnpm → `pnpm <script> --filter <workspace> [args]`
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
  return `pnpm ${script} --filter ${workspace}${argStr}`
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
