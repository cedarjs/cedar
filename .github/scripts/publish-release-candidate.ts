#!/usr/bin/env tsx

/**
 * This script handles the multi-phase publishing process for Cedar release
 * candidates:
 * 1. Temporarily removes create-cedar-app from workspaces
 * 2. Publishes all packages except create-cedar-app
 * 3. Restores workspaces configuration
 * 4. Updates package versions in create-cedar-app templates
 * 5. Generates yarn.lock files for all templates
 * 6. Cleans up temporary files (node_modules, .yarn dirs)
 * 7. Updates JavaScript templates using ts-to-js
 * 8. Publishes the updated create-cedar-app package
 *
 * Usage: yarn tsx .github/scripts/publish-release-candidate.ts [--dry-run]
 * Environment variables required: NPM_AUTH_TOKEN (not needed for dry-run),
 * GITHUB_REF_NAME
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = process.cwd()
const CREATE_CEDAR_APP_DIR = join(REPO_ROOT, 'packages/create-cedar-app')
const TEMPLATES_DIR = join(CREATE_CEDAR_APP_DIR, 'templates')

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
  const prefix = isDryRun ? '🧪 [DRY-RUN]' : '🚀'
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

function updatePackageJsonWithVersion(filePath: string, version: string) {
  log(`Updating ${filePath}`)

  const content = readFileSync(filePath, 'utf-8')
  const packageJson: PackageJson = JSON.parse(content)

  // Update dependencies
  if (packageJson.dependencies) {
    for (const [pkg, currentVersion] of Object.entries(
      packageJson.dependencies,
    )) {
      if (pkg.startsWith('@cedarjs/')) {
        packageJson.dependencies[pkg] = version
      }
    }
  }

  // Update devDependencies
  if (packageJson.devDependencies) {
    for (const [pkg, currentVersion] of Object.entries(
      packageJson.devDependencies,
    )) {
      if (pkg.startsWith('@cedarjs/')) {
        packageJson.devDependencies[pkg] = version
      }
    }
  }

  writeFileSync(filePath, JSON.stringify(packageJson, null, 2) + '\n')
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
    const packageJsonPath = join(REPO_ROOT, workspace.location, 'package.json')

    try {
      const content = readFileSync(packageJsonPath, 'utf-8')
      let updatedContent = content.replace(/workspace:\*/g, version)

      // Also update any @cedarjs dependencies to use the new version
      updatedContent = updatedContent.replace(
        /"@cedarjs\/([^"]+)":\s*"[^"]*"/g,
        `"@cedarjs/$1": "${version}"`,
      )

      if (updatedContent !== content) {
        writeFileSync(packageJsonPath, updatedContent)
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

  const frameworkPackageConfigPath = join(REPO_ROOT, 'package.json')
  const frameworkPackageConfig: PackageJson = JSON.parse(
    readFileSync(frameworkPackageConfigPath, 'utf-8'),
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
  writeFileSync(
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
    execCommand('git reset --hard HEAD~1')
    log('✅ Restored workspaces configuration')
  }
}

function generateYarnLockFile(templateDir: string) {
  const templatePath = join(TEMPLATES_DIR, templateDir)
  log(`Generating yarn.lock for ${templateDir} template`)

  // Remove any existing node_modules and lock files to ensure clean generation
  rmSync(join(templatePath, 'node_modules'), { recursive: true, force: true })
  rmSync(join(templatePath, 'yarn.lock'), { force: true })
  rmSync(join(templatePath, '.yarn'), { recursive: true, force: true })

  try {
    execCommand('yarn install', templatePath)
    log(`✅ Generated yarn.lock for ${templateDir}`)
  } catch (error) {
    console.error(`❌ Failed to generate yarn.lock for ${templateDir}`)
    throw error
  }

  // Clean up generated files except yarn.lock
  rmSync(join(templatePath, 'node_modules'), { recursive: true, force: true })
  rmSync(join(templatePath, '.yarn'), { recursive: true, force: true })
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
    writeFileSync(
      join(REPO_ROOT, '.npmrc'),
      `//registry.npmjs.org/:_authToken=${process.env.NPM_AUTH_TOKEN}\n`,
    )

    // Extract semver type from branch name
    const branchName = process.env.GITHUB_REF_NAME || ''
    // Branch format: release/minor/v0.11.3
    const branchParts = branchName.split('/')

    if (branchParts.length !== 3 || branchParts[0] !== 'release') {
      throw new Error(
        `Invalid branch name format. Expected: release/{semver}/v{version}, got: ${branchName}`,
      )
    }

    const semver = branchParts[1] // 'minor'

    log(`Publishing release candidate with ${semver} bump`)

    // Step 1: Temporarily remove create-cedar-app from workspaces
    log('Step 1: Removing create-cedar-app from workspaces')
    restoreWorkspaces = await removeCreateCedarAppFromWorkspaces()

    log('Step 2: Publishing RC versions of all packages')

    const publishArgs = [
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
      '--yes',
    ]

    let publishOutput: string

    if (isDryRun) {
      // Remove --yes flag and pipe 'n' to answer "no" to publish prompt
      const dryRunArgs = publishArgs.filter((arg) => arg !== '--yes')
      publishOutput = execCommand(
        `yarn ${dryRunArgs.join(' ')}`,
        REPO_ROOT,
        'n\n',
      )
      log('✅ Dry-run completed - got version info without publishing')
    } else {
      publishOutput = execCommand(`yarn ${publishArgs.join(' ')}`)
      log('✅ Published packages except create-cedar-app')
    }

    console.log('Publish output:')
    console.log('Publish output:', publishOutput)
    console.log('Publish output:')

    // Step 3: Restore workspaces configuration
    log('Step 3: Restoring workspaces configuration')
    if (restoreWorkspaces) {
      restoreWorkspaces()
      restoreWorkspaces = null // Mark as cleaned up
    }

    // Step 4: Extract the published version from lerna output
    log('Step 4: Extracting published version')

    let publishedVersion: string | null = null

    // Look for RC version pattern in the canary publish output
    const rcVersionMatch = publishOutput.match(/(\d+\.\d+\.\d+-rc\.\d+)/g)
    if (rcVersionMatch && rcVersionMatch.length > 0) {
      publishedVersion = rcVersionMatch[rcVersionMatch.length - 1]
    }

    // Fallback: Look for "=> version" pattern like in canary script
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

    log(`Published version: ${publishedVersion}`)

    // Step 5: Update package.json files in templates
    log('Step 5: Updating package.json files in templates')

    for (const templateDir of TEMPLATE_DIRS) {
      const templatePath = join(TEMPLATES_DIR, templateDir)

      // Update root package.json
      updatePackageJsonWithVersion(
        join(templatePath, 'package.json'),
        publishedVersion,
      )

      // Update web/package.json
      updatePackageJsonWithVersion(
        join(templatePath, 'web/package.json'),
        publishedVersion,
      )

      // Update api/package.json
      updatePackageJsonWithVersion(
        join(templatePath, 'api/package.json'),
        publishedVersion,
      )
    }

    log('✅ Updated all template package.json files')

    // Step 6: Update workspace dependencies across all packages
    log('Step 6: Updating workspace dependencies')
    updateWorkspaceDependencies(publishedVersion)

    // Step 7: Update JavaScript templates using ts-to-js
    updateJavaScriptTemplates()

    // Step 8: Generate yarn.lock files for each template
    log('Step 8: Generating yarn.lock files for templates')

    for (const templateDir of TEMPLATE_DIRS) {
      generateYarnLockFile(templateDir)
    }

    log('✅ Generated all yarn.lock files')

    // Step 9: Commit changes before publishing create-cedar-app
    log('Step 9: Committing template updates')
    execCommand('git config user.name "GitHub Actions"')
    execCommand('git config user.email "actions@github.com"')
    execCommand('git add .')
    execCommand(
      'git commit -m "Update create-cedar-app templates to use RC packages"',
    )

    // Step 10: Publish create-cedar-app
    log('Step 10: Publishing create-cedar-app')

    const createCedarAppPublishArgs = [
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
      '--scope',
      'create-cedar-app',
      '--yes',
    ]

    if (isDryRun) {
      // Remove --yes flag and pipe 'n' to answer "no" to publish prompt
      const dryRunArgs = createCedarAppPublishArgs.filter(
        (arg) => arg !== '--yes',
      )
      execCommand(`yarn ${dryRunArgs.join(' ')}`, REPO_ROOT, 'n\n')
      log('✅ Dry-run completed - would have published create-cedar-app')
    } else {
      execCommand(`yarn ${createCedarAppPublishArgs.join(' ')}`)
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

// Run the script
main()
