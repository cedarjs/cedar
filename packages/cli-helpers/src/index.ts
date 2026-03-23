// @WARN: This export is going to cause memory problems in the CLI.
// We need to split this into smaller packages, or use export aliasing (like in packages/testing/cache)

export * from './lib/index.js'
export * from './lib/colors.js'
export { loadEnvFiles } from './lib/loadEnvFiles.js'
export {
  loadDefaultEnvFiles,
  loadNodeEnvDerivedEnvFile,
  loadUserSpecifiedEnvFiles,
} from './lib/loadEnvFiles.js'
export * from './lib/paths.js'
export * from './lib/project.js'
export * from './lib/version.js'
export * from './auth/setupHelpers.js'
export type { AuthHandlerArgs, AuthGeneratorCtx } from './auth/setupHelpers.js'

export * from './lib/installHelpers.js'

export * from './telemetry/index.js'

export {
  runScript,
  addRootPackages,
  addWorkspacePackages,
  removeWorkspacePackages,
  runBin,
  runWorkspaceBin,
  dlx,
  dedupe,
  installPackagesFor,
} from './lib/packageManager/commands.js'
export {
  formatCedarCommand,
  formatRunBinCommand,
  formatInstallCommand,
  formatAddRootPackagesCommand,
  formatAddWorkspacePackagesCommand,
  formatRemoveWorkspacePackagesCommand,
  formatRunScriptCommand,
  formatRunWorkspaceScriptCommand,
  formatRunWorkspaceBinCommand,
  formatDlxCommand,
} from './lib/packageManager/display.js'
export { getPackageManager } from './lib/packageManager/config.js'
export {
  runPackageManagerCommand,
  installPackagesTask,
  addWorkspacePackagesTask,
  addRootPackagesTask,
} from './lib/packageManager/helpers.js'
