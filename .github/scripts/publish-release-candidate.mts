/**
 * This script handles the multi-phase publishing process for Cedar release
 * candidates
 *
 * Usage: yarn tsx .github/scripts/publish-release-candidate.mts [--dry-run]
 * Environment variables required: NPM_AUTH_TOKEN (not needed for dry-run),
 * GITHUB_REF_NAME
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'

const REPO_ROOT = process.cwd()
const CREATE_CEDAR_APP_DIR = path.join(REPO_ROOT, 'packages/create-cedar-app')
const TEMPLATES_DIR = path.join(CREATE_CEDAR_APP_DIR, 'templates')

// Template directories
const TEMPLATE_DIRS = ['ts', 'js', 'esm-ts', 'esm-js']

// Dependency fields whose in-monorepo entries get rewritten to the version
// being published
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
] as const

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  workspaces?: string[] | { packages: string[] }
  [key: string]: any
}

interface WorkspaceInfo {
  name: string
  location: string
}

// Check for dry-run mode
const isDryRun = process.argv.includes('--dry-run')

function log(message: string) {
  const prefix = isDryRun ? '[DRY-RUN]' : '•'
  console.log(`${prefix} ${message}`)
}

function execCommand(
  command: string,
  cwd: string = REPO_ROOT,
  input?: string,
): string {
  log(`Executing: ${command}`)

  // In dry-run mode, we only skip actual publishing - everything else runs for
  // real

  try {
    return execSync(command, {
      cwd,
      encoding: 'utf-8',
      input: input,
      stdio: [input ? 'pipe' : 'inherit', 'pipe', 'inherit'],
    })
      .toString()
      .trim()
  } catch (error) {
    console.error(`❌ Command failed: ${command}`)
    throw error
  }
}

/**
 * Rewrites the deps of a package.json that lives outside the workspace graph
 * (create-cedar-app itself and its templates) to `version`.
 *
 * `workspaceNames` covers packages published from this monorepo that aren't
 * `@cedarjs/`-scoped, such as `storybook-framework-cedarjs`.
 */
function readPackageJson(pkgJsonPath: string): PackageJson {
  return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
}

function writePackageJson(pkgJsonPath: string, pkgJson: PackageJson) {
  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n')
}

/**
 * Resolves a workspace's package.json path, failing loudly if it's missing.
 *
 * Yarn only reports a workspace because it found a package.json there, so a
 * missing one means the checkout is corrupt — never something to skip past on
 * the way to publishing.
 */
function workspacePackageJsonPath(workspace: WorkspaceInfo) {
  const pkgJsonPath = path.join(REPO_ROOT, workspace.location, 'package.json')

  if (!fs.existsSync(pkgJsonPath)) {
    throw new Error(`No package.json at ${workspace.location}/package.json`)
  }

  return pkgJsonPath
}

function updatePackageJsonWithVersion(
  filePath: string,
  version: string,
  workspaceNames: Set<string>,
  updateOwnVersion = false,
) {
  log(`Updating ${filePath}`)

  const packageJson = readPackageJson(filePath)

  // Update the package's own version if requested
  if (updateOwnVersion) {
    packageJson.version = version
  }

  for (const depField of DEPENDENCY_FIELDS) {
    const deps = packageJson[depField]

    if (!deps) {
      continue
    }

    for (const depName of Object.keys(deps)) {
      if (depName.startsWith('@cedarjs/') || workspaceNames.has(depName)) {
        deps[depName] = version
      }
    }
  }

  writePackageJson(filePath, packageJson)
}

/**
 * Rewrites every dependency that points at another package in this monorepo to
 * `version`.
 *
 * Membership is decided by package *name* (from `yarn workspaces list`), not by
 * the `@cedarjs/` prefix or the `workspace:*` spec. Release branches carry a
 * "update package versions to vX.Y.Z" commit that has already replaced
 * `workspace:*` with a plain release version, and not every workspace package
 * is `@cedarjs/`-scoped (e.g. `storybook-framework-cedarjs`), so both of those
 * narrower checks miss deps that still need bumping.
 */
function updateWorkspaceDependencies(
  workspaces: WorkspaceInfo[],
  version: string,
) {
  log('Updating workspace dependencies across all packages')

  const workspaceNames = new Set(workspaces.map((ws) => ws.name))

  for (const workspace of workspaces) {
    const packageJsonPath = workspacePackageJsonPath(workspace)
    const packageJson = readPackageJson(packageJsonPath)
    let changed = false

    for (const depField of DEPENDENCY_FIELDS) {
      const deps = packageJson[depField]

      if (!deps) {
        continue
      }

      for (const depName of Object.keys(deps)) {
        if (workspaceNames.has(depName) && deps[depName] !== version) {
          deps[depName] = version
          changed = true
        }
      }
    }

    if (changed) {
      writePackageJson(packageJsonPath, packageJson)
      log(
        'Updated workspace dependencies in ' +
          `${workspace.location}/package.json`,
      )
    }
  }
}

/**
 * Fails the release before anything reaches npm if a package still points at a
 * version of a sibling package that isn't the one being published.
 *
 * RC 5.0.2-rc.3 shipped `storybook-framework-cedarjs@5.0.2`, a version that
 * never existed on npm, and nothing caught it until users hit
 * "No candidates found" during install.
 */
function verifyWorkspaceDependencies(
  workspaces: WorkspaceInfo[],
  version: string,
) {
  log('Verifying in-monorepo dependencies all point at the version to publish')

  const workspaceNames = new Set(workspaces.map((ws) => ws.name))
  const problems: string[] = []

  for (const workspace of workspaces) {
    const packageJson = readPackageJson(workspacePackageJsonPath(workspace))

    if (packageJson.version !== version) {
      problems.push(`${workspace.name} has version ${packageJson.version}`)
    }

    for (const depField of DEPENDENCY_FIELDS) {
      const deps = packageJson[depField]

      if (!deps) {
        continue
      }

      for (const [depName, depVersion] of Object.entries(deps)) {
        if (workspaceNames.has(depName) && depVersion !== version) {
          problems.push(
            `${workspace.name} ${depField}.${depName} is ${depVersion}`,
          )
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Expected every in-monorepo dependency to be ${version}, but found:\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    )
  }

  log('✅ All in-monorepo dependencies point at ' + version)
}

async function removeCreateCedarAppFromWorkspaces(): Promise<() => void> {
  log('Temporarily removing create-cedar-app from workspaces')

  // Store current commit SHA before making any changes
  const initialCommitSha = execCommand('git rev-parse HEAD').trim()

  const frameworkPackageConfigPath = path.join(REPO_ROOT, 'package.json')
  const frameworkPackageConfig: PackageJson = JSON.parse(
    fs.readFileSync(frameworkPackageConfigPath, 'utf-8'),
  )

  // Get current workspace packages
  const workspacesOutput = execCommand('yarn workspaces list --json')
  const packagePaths = workspacesOutput
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter(({ name }: WorkspaceInfo) => name)
    .map(({ location }: WorkspaceInfo) => location)

  // Filter out create-cedar-app
  const filteredWorkspaces = packagePaths.filter(
    (packagePath: string) => packagePath !== 'packages/create-cedar-app',
  )

  // Update workspaces configuration
  if (Array.isArray(frameworkPackageConfig.workspaces)) {
    frameworkPackageConfig.workspaces = filteredWorkspaces
  } else if (
    frameworkPackageConfig.workspaces &&
    typeof frameworkPackageConfig.workspaces === 'object' &&
    'packages' in frameworkPackageConfig.workspaces
  ) {
    frameworkPackageConfig.workspaces.packages = filteredWorkspaces
  }

  // Write updated configuration
  fs.writeFileSync(
    frameworkPackageConfigPath,
    JSON.stringify(frameworkPackageConfig, null, 2) + '\n',
  )

  // Commit the temporary change
  execCommand('git add package.json')
  execCommand('git commit -m "chore: temporary update to workspaces"')

  log('✅ Temporarily removed create-cedar-app from workspaces')

  // Return cleanup function
  return () => {
    log('Restoring workspaces configuration')
    execCommand(`git reset --hard ${initialCommitSha}`)
    log('✅ Restored workspaces configuration')
  }
}

function generateYarnLockFile(templateDir: string) {
  const templatePath = path.join(TEMPLATES_DIR, templateDir)
  log(`Generating yarn.lock in ${templatePath}`)

  // Remove any existing node_modules and lock files to ensure clean generation
  fs.rmSync(path.join(templatePath, 'node_modules'), {
    recursive: true,
    force: true,
  })
  fs.rmSync(path.join(templatePath, 'yarn.lock'), { force: true })
  fs.rmSync(path.join(templatePath, '.yarn'), { recursive: true, force: true })

  // Create empty yarn.lock file (required for yarn to treat as separate
  // project)
  fs.writeFileSync(path.join(templatePath, 'yarn.lock'), '')
  log(`Created empty yarn.lock for ${templateDir}`)

  try {
    // Set CI=false to disable immutable mode for yarn install
    const originalCI = process.env.CI
    process.env.CI = 'false'

    execCommand('yarn install', templatePath)

    // Restore original CI value
    if (originalCI) {
      process.env.CI = originalCI
    } else {
      delete process.env.CI
    }

    log(`✅ Generated yarn.lock for ${templateDir}`)
  } catch (error) {
    console.error(`❌ Failed to generate yarn.lock for ${templateDir}`)
    throw error
  }

  // Clean up generated files except yarn.lock
  fs.rmSync(path.join(templatePath, 'node_modules'), {
    recursive: true,
    force: true,
  })
  fs.rmSync(path.join(templatePath, '.yarn'), { recursive: true, force: true })
}

function updateJavaScriptTemplates() {
  log('Updating JavaScript templates using ts-to-js')

  try {
    execCommand('yarn ts-to-js', CREATE_CEDAR_APP_DIR)
    log('✅ Updated JavaScript templates')
  } catch (error) {
    console.error('❌ Failed to update JavaScript templates')
    throw error
  }
}

async function main() {
  let restoreWorkspaces: (() => void) | null = null

  try {
    // Check if NPM_AUTH_TOKEN is set (not required for dry-run)
    if (!isDryRun && !process.env.NPM_AUTH_TOKEN) {
      throw new Error('NPM_AUTH_TOKEN environment variable is not set')
    }

    // Set up .npmrc for publishing
    log('Setting up npm authentication')
    fs.writeFileSync(
      path.join(REPO_ROOT, '.npmrc'),
      `//registry.npmjs.org/:_authToken=${process.env.NPM_AUTH_TOKEN}\n`,
    )

    // Set up git configuration for CI environment
    log('Setting up git configuration')
    execCommand('git config user.name "GitHub Actions"')
    execCommand('git config user.email "actions@github.com"')

    // Extract semver type from branch name
    const branchName = process.env.GITHUB_REF_NAME || ''
    // Branch format: release/minor/v0.11.3
    const branchParts = branchName.split('/')

    if (branchParts.length !== 3 || branchParts[0] !== 'release') {
      throw new Error(
        'Invalid branch name format. Expected: release/{semver}/v{version}, ' +
          `got: ${branchName}`,
      )
    }

    // i.e. 'minor'
    const semver = branchParts[1]

    log(`Publishing release candidate with ${semver} bump`)

    log('Step 1: Removing create-cedar-app from workspaces')
    restoreWorkspaces = await removeCreateCedarAppFromWorkspaces()

    log('Step 2: Calculating RC version')

    const latestTag = execCommand('git describe --abbrev=0 --tags').trim()
    const currentVersion = latestTag.replace(/^v/, '')
    const [major, minor, patch] = currentVersion.split('.').map(Number)

    let baseVersion: string
    switch (semver) {
      case 'major':
        baseVersion = `${major + 1}.0.0`
        break
      case 'minor':
        baseVersion = `${major}.${minor + 1}.0`
        break
      case 'patch':
        baseVersion = `${major}.${minor}.${patch + 1}`
        break
      default:
        throw new Error(`Unknown semver type: ${semver}`)
    }

    const commitCount = execCommand(
      `git rev-list --count ${latestTag}..HEAD`,
    ).trim()

    const versionToPublish = `${baseVersion}-rc.${commitCount}`
    log(`✅ Calculated RC version: ${versionToPublish}`)

    log('Step 4: Manually updating package.json files with calculated version')

    // Get all workspace packages and update their versions
    const workspacesOutput = execCommand('yarn workspaces list --json')
    const workspaces: WorkspaceInfo[] = workspacesOutput
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
      .filter((ws) => ws.location !== '.')

    for (const workspace of workspaces) {
      const packageJsonPath = workspacePackageJsonPath(workspace)
      const packageJson = readPackageJson(packageJsonPath)

      // Update the version
      packageJson.version = versionToPublish

      writePackageJson(packageJsonPath, packageJson)
      log(`Updated version in ${workspace.location}/package.json`)
    }

    log('Step 5: Updating workspace dependencies')
    updateWorkspaceDependencies(workspaces, versionToPublish)

    const workspaceNames = new Set(workspaces.map((ws) => ws.name))

    verifyWorkspaceDependencies(workspaces, versionToPublish)

    log('Step 6: Committing version and dependency updates')
    execCommand('git add .')
    execCommand('git commit -m "Update package versions and workspace deps"')

    log('Step 7: Publishing RC versions of all packages')

    await publishPackages('rc', isDryRun)

    log('Step 8: Restoring workspaces configuration')
    if (restoreWorkspaces) {
      restoreWorkspaces()
      restoreWorkspaces = null // Mark as cleaned up
    }

    // Recreate .npmrc file after git reset (which removed it)
    if (!isDryRun) {
      log('Recreating .npmrc file after workspace restoration')
      fs.writeFileSync(
        path.join(REPO_ROOT, '.npmrc'),
        `//registry.npmjs.org/:_authToken=${process.env.NPM_AUTH_TOKEN}\n`,
      )
      log('✅ Recreated .npmrc file')
    }

    log('Step 9: Waiting for packages to be available on npm')

    // Add delay to allow for the packages to be available on the NPM registry
    // and for cache propagation
    log('Waiting 10 seconds for NPM publishing and registry propagation...')
    await setTimeout(10_000)

    // Make sure the three main packages are available
    const packagesToWaitFor = ['@cedarjs/core', '@cedarjs/cli', '@cedarjs/api']

    for (const packageName of packagesToWaitFor) {
      if (isDryRun) {
        log(`Dry-run - skip waitForNpm for ${packageName}`)
        continue
      }

      const packageAvailable = await waitForNpm(packageName, versionToPublish)
      if (!packageAvailable) {
        throw new Error(`Package ${packageName} not available in time on npm`)
      }
    }

    log('✅ Packages are now available on npm')

    log('Step 10: Updating template package.json files')

    // Find all package.json files across templates and database-overlays,
    // excluding node_modules. This covers base templates, overlay variants
    // (cjs/esm × npm/pnpm/yarn), and database overlays in one pass.
    const packageJsonFiles = fs.globSync(
      ['templates/**/package.json', 'database-overlays/**/package.json'],
      {
        cwd: CREATE_CEDAR_APP_DIR,
        exclude: (filePath) => filePath.includes('node_modules'),
      },
    )

    for (const pkgJsonFile of packageJsonFiles) {
      updatePackageJsonWithVersion(
        path.join(CREATE_CEDAR_APP_DIR, pkgJsonFile),
        versionToPublish,
        workspaceNames,
      )
    }

    log('✅ Updated all template package.json files')

    updateJavaScriptTemplates()

    log('Step 11: Generating yarn.lock files for templates')

    for (const templateDir of TEMPLATE_DIRS) {
      if (isDryRun) {
        log(`Dry-run - skip generateYarnLockFile for ${templateDir}`)
        continue
      }

      generateYarnLockFile(templateDir)
    }

    log('✅ Generated all yarn.lock files')

    if (isDryRun) {
      log('📝 Dry-run - skipping git commit and create-cedar-app publish')
      log('🔄 Reverting changes made during dry-run...')
      execCommand('git checkout -- .')
      execCommand('git clean -fd')
      log('✅ Dry-run completed - all changes reverted')
      return
    }

    log('Step 12: Setting up workspace for create-cedar-app only')

    // Update workspace configuration to only include create-cedar-app
    const frameworkPackageConfigPath = path.join(REPO_ROOT, 'package.json')
    const frameworkPackageConfig: PackageJson = JSON.parse(
      fs.readFileSync(frameworkPackageConfigPath, 'utf-8'),
    )

    // Set workspace to only include create-cedar-app
    if (Array.isArray(frameworkPackageConfig.workspaces)) {
      frameworkPackageConfig.workspaces = ['packages/create-cedar-app']
    } else if (
      frameworkPackageConfig.workspaces &&
      typeof frameworkPackageConfig.workspaces === 'object' &&
      'packages' in frameworkPackageConfig.workspaces
    ) {
      frameworkPackageConfig.workspaces.packages = ['packages/create-cedar-app']
    }

    // Write updated configuration
    fs.writeFileSync(
      frameworkPackageConfigPath,
      JSON.stringify(frameworkPackageConfig, null, 2) + '\n',
    )

    // Commit the workspace change for clean working directory
    execCommand('git add package.json')
    execCommand(
      'git commit -m "Set workspace to create-cedar-app only for publishing"',
    )

    log('Step 13: Committing template updates')
    execCommand('git add .')
    execCommand(
      'git commit -m "Update create-cedar-app templates to use RC packages"',
    )

    log('Step 14: Publishing create-cedar-app')

    // Update create-cedar-app version before publishing
    log('Updating create-cedar-app version before publishing')
    const createCedarAppPackageJsonPath = path.join(
      CREATE_CEDAR_APP_DIR,
      'package.json',
    )
    updatePackageJsonWithVersion(
      createCedarAppPackageJsonPath,
      versionToPublish,
      workspaceNames,
      true,
    )
    log(`✅ Updated create-cedar-app version to ${versionToPublish}`)

    // Commit the version update
    execCommand('git add packages/create-cedar-app/package.json')
    execCommand(
      `git commit -m "Update create-cedar-app version to ${versionToPublish}"`,
    )
    log('✅ Committed create-cedar-app version update')

    if (isDryRun) {
      log('✅ Dry-run completed - would have published create-cedar-app')
    } else {
      const ccaPkgJsonPath = path.join(CREATE_CEDAR_APP_DIR, 'package.json')
      const ccaPkgJson: PackageJson = JSON.parse(
        fs.readFileSync(ccaPkgJsonPath, 'utf-8'),
      )
      const ccaPackageName = ccaPkgJson.name || 'create-cedar-app'
      log(`Publishing ${ccaPackageName}@${versionToPublish}...`)
      execCommand(`npm publish --tag rc --access public`, CREATE_CEDAR_APP_DIR)
      log('✅ Published create-cedar-app')
    }

    log('🎉 Release candidate publishing completed successfully!')
  } catch (error) {
    console.error('❌ Release candidate publishing failed:')
    console.error(error)

    // Ensure workspace cleanup happens even on error
    if (restoreWorkspaces) {
      try {
        log('Cleaning up workspace changes due to error...')
        restoreWorkspaces()
      } catch (cleanupError) {
        console.error('❌ Failed to cleanup workspace changes:')
        console.error(cleanupError)
      }
    }

    process.exit(1)
  }
}

function isErrorWithMessage(err: unknown): err is { message: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof err.message === 'string'
  )
}

async function isPublished(packageName: string, version: string) {
  const headers = {
    accept:
      'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*',
  }

  const registryUrl = 'https://registry.npmjs.org/'
  const packageUrl = new URL(
    encodeURIComponent(packageName).replace(/^%40/, '@'),
    registryUrl,
  )

  const response = await fetch(packageUrl, {
    method: 'GET',
    headers,
    keepalive: true,
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(packageName + ' not found')
    }

    throw new Error(`HTTP error! status: ${response.status}`)
  }

  const data = await response.json()

  // Check if the specific version exists in the versions object
  if (data?.versions[version]) {
    return true
  }

  return false
}

async function waitForNpm(packageName: string, version: string) {
  const maxWaitTime = 20_000 // 20 seconds
  const startTime = Date.now()
  let packageAvailable = false

  while (!packageAvailable && Date.now() - startTime < maxWaitTime) {
    const timeDiff = Date.now() - startTime
    const nextWaitTime = timeDiff > 10_000 ? 5_000 : 2_500
    try {
      const packageIsPublished = await isPublished(packageName, version)
      log(`Checking npm registry for ${packageName}@${version}...`)

      if (packageIsPublished) {
        packageAvailable = true
        log(`Package ${packageName}@${version} is now available on npm!`)
      } else {
        log(`Waiting for ${packageName}@${version} to be available...`)

        // Wait for `nextWaitTime` before checking again
        await setTimeout(nextWaitTime)
      }
    } catch (error) {
      const errorMessage = isErrorWithMessage(error)
        ? error.message
        : 'Unknown error'
      log(`Error checking package availability: ${errorMessage}`)

      // Wait for 1 second before checking again
      await setTimeout(1000)
    }
  }

  return packageAvailable
}

async function publishPackage(
  packageName: string,
  version: string,
  distTag: string,
  packageDir: string,
  dryRun: boolean,
) {
  if (dryRun) {
    log(`Dry-run: would publish ${packageName}@${version} --tag ${distTag}`)
    return
  }

  const alreadyPublished = await isPublished(packageName, version)
  if (alreadyPublished) {
    log(`Already published: ${packageName}@${version}`)
    return
  }

  log(`Publishing ${packageName}@${version}...`)
  execCommand(`npm publish --tag ${distTag} --access public`, packageDir)
  log(`✅ Published ${packageName}@${version}`)
}

async function publishPackages(distTag: string, dryRun: boolean) {
  const workspacesOutput = execCommand('yarn workspaces list --json')
  const workspaces: WorkspaceInfo[] = workspacesOutput
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((ws) => ws.location !== '.')

  for (const workspace of workspaces) {
    const pkgJsonPath = path.join(REPO_ROOT, workspace.location, 'package.json')
    try {
      const pkgJson: PackageJson = JSON.parse(
        fs.readFileSync(pkgJsonPath, 'utf-8'),
      )
      if (pkgJson.private) {
        log(`Skipping private package: ${pkgJson.name}`)
        continue
      }
      await publishPackage(
        pkgJson.name,
        pkgJson.version,
        distTag,
        path.join(REPO_ROOT, workspace.location),
        dryRun,
      )
    } catch (e) {
      log(`❌ Failed to publish ${workspace.location}: ${e}`)
      throw e
    }
  }
}

// Run the script
main()
