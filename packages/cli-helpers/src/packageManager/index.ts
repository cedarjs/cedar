import { getPackageManager } from '@cedarjs/project-config/packageManager'

export function workspacePackageSpecifier(): string {
  if (getPackageManager() === 'npm') {
    return '*'
  }

  return 'workspace:*'
}

export function add() {
  const pm = getPackageManager()
  return pm === 'npm' ? 'install' : 'add'
}

export function install() {
  return 'install'
}

export function dedupe() {
  if (getPackageManager() === 'yarn') {
    return 'dedupe'
  }

  return undefined
}

export function installationErrorMessage() {
  if (getPackageManager() === 'yarn') {
    return (
      'Could not finish installation. Please run `yarn install` and then ' +
      '`yarn dedupe`, before continuing'
    )
  }

  return (
    `Could not finish installation. Please run \`${getPackageManager()} ` +
    `${install()} \` before continuing`
  )
}

/**
 * Gets a string suitable for displaying to the user when telling them to run a
 * Cedar bin command, like `yarn cedar upgrade` or
 * `yarn cedar generate page home /`.
 */
export function prettyPrintCedarCommand(args: string[]): string {
  const packageManager = getPackageManager()

  const packageManagerBin = packageManager === 'npm' ? 'npx' : packageManager

  return `${packageManagerBin} cedar ${args.join(' ')}`
}
