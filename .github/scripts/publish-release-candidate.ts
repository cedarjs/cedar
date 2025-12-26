#!/usr/bin/env tsx

/**
 * This script handles the multi-phase publishing process for Cedar release
 * candidates
 *
 * Usage: yarn tsx .github/scripts/publish-release-candidate.ts [--dry-run]
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

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
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

function updatePackageJsonWithVersion(
  filePath: string,
  version: string,
  updateOwnVersion = false,
) {
  log(`Updating ${filePath}`)

  const content = fs.readFileSync(filePath, 'utf-8')
  const packageJson: PackageJson = JSON.parse(content)

  // Update the package's own version if requested
  if (updateOwnVersion) {
    packageJson.version = version
  }

  // Update dependencies
  if (packageJson.dependencies) {
    for (const [pkg] of Object.entries(packageJson.dependencies)) {
      if (pkg.startsWith('@cedarjs/')) {
        packageJson.dependencies[pkg] = version
      }
    }
  }

  // Update devDependencies
  if (packageJson.devDependencies) {
    for (const [pkg] of Object.entries(packageJson.devDependencies)) {
      if (pkg.startsWith('@cedarjs/')) {
        packageJson.devDependencies[pkg] = version
      }
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(packageJson, null, 2) + '\n')
}

function updateWorkspaceDependencies(version: string) {
  log('Updating workspace dependencies across all packages')

  // Get all workspace packages
  const workspacesOutput = execCommand('yarn workspaces list --json')
  const workspaces: WorkspaceInfo[] = workspacesOutput
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((ws) => ws.location !== '.')

  for (const workspace of workspaces) {
    const packageJsonPath = path.join(
      REPO_ROOT,
      workspace.location,
      'package.json',
    )

    try {
      const content = fs.readFileSync(packageJsonPath, 'utf-8')
      let updatedContent = content.replace(/workspace:\*/g, version)

      // Also update any @cedarjs dependencies to use the new version
      updatedContent = updatedContent.replace(
        /"@cedarjs\/([^"]+)":\s*"[^"]*"/g,
        `"@cedarjs/$1": "${version}"`,
      )

      if (updatedContent !== content) {
        fs.writeFileSync(packageJsonPath, updatedContent)
        log(
          'Updated workspace dependencies in ' +
            `${workspace.location}/package.json`,
        )
      }
    } catch (error) {
      // Skip if package.json doesn't exist or can't be read
      continue
    }
  }
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

    log('Step 2: Calculating RC version without publishing')

    let publishOutput: string

    // Temporarily set workspace to only include @cedarjs/core for version
    // calculation
    log('Setting workspace to only @cedarjs/core for version calculation')
    const versionCalcPackageConfigPath = path.join(REPO_ROOT, 'package.json')
    const originalVersionCalcConfig = fs.readFileSync(
      versionCalcPackageConfigPath,
      'utf-8',
    )
    const versionCalcPackageConfig: PackageJson = JSON.parse(
      originalVersionCalcConfig,
    )

    // Update workspace to only include core package
    if (Array.isArray(versionCalcPackageConfig.workspaces)) {
      versionCalcPackageConfig.workspaces = ['packages/core']
    } else if (
      versionCalcPackageConfig.workspaces &&
      typeof versionCalcPackageConfig.workspaces === 'object' &&
      'packages' in versionCalcPackageConfig.workspaces
    ) {
      versionCalcPackageConfig.workspaces.packages = ['packages/core']
    }

    fs.writeFileSync(
      versionCalcPackageConfigPath,
      JSON.stringify(versionCalcPackageConfig, null, 2) + '\n',
    )

    execCommand('git add package.json')
    execCommand('git commit -m "tmp @cedarjs/core only workspace update"')

    const versioningArgs = [
      'lerna',
      'publish',
      `pre${semver}`,
      '--include-merged-tags',
      '--exact',
      '--canary',
      '--preid',
      'rc',
      '--dist-tag',
      'rc',
      '--force-publish',
      '--loglevel',
      'verbose',
      '--no-git-reset',
    ].join(' ')

    log('📝 dry-run canary publish of @cedarjs/core to calculate version')
    // lerna will ask for confirmation before publishing. We pass 'n' as input
    // to answer "no" to that question to abort the publishing process. That's
    // how we make this a dry-run
    publishOutput = execCommand(`yarn ${versioningArgs}`, REPO_ROOT, 'n\n')

    log('Restoring original workspace configuration')
    fs.writeFileSync(versionCalcPackageConfigPath, originalVersionCalcConfig)
    log('✅ Completed version calculation without publishing')

    log('Step 3: Extracting calculated version')

    let publishedVersion: string | null = null

    // Look for RC version pattern in the canary publish output
    const rcVersionMatch = publishOutput.match(/(\d+\.\d+\.\d+-rc\.\d+)/g)
    if (rcVersionMatch && rcVersionMatch.length > 0) {
      publishedVersion = rcVersionMatch[rcVersionMatch.length - 1]
    }

    // Fallback: Look for "=> version" pattern
    if (!publishedVersion) {
      const versionMatch = publishOutput.match(/=> ([^\s+]+)/g)
      if (versionMatch && versionMatch.length > 0) {
        const lastMatch = versionMatch[versionMatch.length - 1]
        publishedVersion = lastMatch.replace(/^=> /, '').replace(/\+.*$/, '')
      }
    }

    if (!publishedVersion) {
      console.error('Lerna publish output:')
      console.error(publishOutput)
      throw new Error('Could not extract RC version from lerna output')
    }

    log(`✅ Extracted published version: ${publishedVersion}`)

    log('Step 4: Manually updating package.json files with calculated version')

    // Since we only did a dry-run canary publish lerna didn't actually version
    // the files, we need to do it manually
    // Get all workspace packages and update their versions
    const workspacesOutput = execCommand('yarn workspaces list --json')
    const workspaces: WorkspaceInfo[] = workspacesOutput
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
      .filter((ws) => ws.location !== '.')

    for (const workspace of workspaces) {
      const packageJsonPath = path.join(
        REPO_ROOT,
        workspace.location,
        'package.json',
      )
      try {
        const content = fs.readFileSync(packageJsonPath, 'utf-8')
        const packageJson = JSON.parse(content)

        // Update the version
        packageJson.version = publishedVersion

        fs.writeFileSync(
          packageJsonPath,
          JSON.stringify(packageJson, null, 2) + '\n',
        )
        log(`Updated version in ${workspace.location}/package.json`)
      } catch (error) {
        // Skip if package.json doesn't exist or can't be read
        continue
      }
    }

    log('Step 5: Updating workspace dependencies')
    updateWorkspaceDependencies(publishedVersion)

    log('Step 6: Committing version and dependency updates')
    execCommand('git add .')
    execCommand('git commit -m "Update package versions and workspace deps"')

    log('Step 7: Publishing RC versions of all packages')

    const publishArgs = [
      'lerna',
      'publish',
      'from-package',
      '--dist-tag',
      'rc',
      '--loglevel',
      'verbose',
    ].join(' ')

    if (isDryRun) {
      // Pipe 'n' to answer "no" to publish prompt
      execCommand(`yarn ${publishArgs}`, REPO_ROOT, 'n\n')
      log('✅ Dry-run - tested publish command without actually publishing')
    } else {
      execCommand(`yarn ${publishArgs} --yes`)
      log('✅ Published packages except create-cedar-app')
    }

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

      const packageAvailable = await waitForNpm(packageName, publishedVersion)
      if (!packageAvailable) {
        throw new Error(`Package ${packageName} not available in time on npm`)
      }
    }

    log('✅ Packages are now available on npm')

    log('Step 10: Updating template package.json files')

    for (const templateDir of TEMPLATE_DIRS) {
      const templatePath = path.join(TEMPLATES_DIR, templateDir)

      // Update root package.json
      updatePackageJsonWithVersion(
        path.join(templatePath, 'package.json'),
        publishedVersion,
      )

      // Update web/package.json
      updatePackageJsonWithVersion(
        path.join(templatePath, 'web/package.json'),
        publishedVersion,
      )

      // Update api/package.json
      updatePackageJsonWithVersion(
        path.join(templatePath, 'api/package.json'),
        publishedVersion,
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
      publishedVersion,
      true,
    )
    log(`✅ Updated create-cedar-app version to ${publishedVersion}`)

    // Commit the version update
    execCommand('git add packages/create-cedar-app/package.json')
    execCommand(
      `git commit -m "Update create-cedar-app version to ${publishedVersion}"`,
    )
    log('✅ Committed create-cedar-app version update')

    const ccaPublishArgs = [
      'lerna',
      'publish',
      'from-package',
      '--dist-tag',
      'rc',
      '--loglevel',
      'verbose',
    ]

    if (isDryRun) {
      // Pipe 'n' to answer "no" to publish prompt
      execCommand(`yarn ${ccaPublishArgs.join(' ')}`, REPO_ROOT, 'n\n')
      log('✅ Dry-run completed - would have published create-cedar-app')
    } else {
      execCommand(`yarn ${ccaPublishArgs.join(' ')} --yes`)
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
    typeof (err as { message: unknown }).message === 'string'
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
  if (data.versions && data.versions[version]) {
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

// Run the script
main()
