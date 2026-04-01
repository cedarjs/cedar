import type { PackageManager } from './handle-args.js'

export function getInstallCommand(pm: PackageManager) {
  return `${pm} install`
}

export function getBinExecutor(pm: PackageManager) {
  return pm === 'npm' ? 'npx' : pm
}

export function getCedarCommandPrefix(pm: PackageManager) {
  const binExecutor = getBinExecutor(pm)

  return `${binExecutor} cedar`
}
