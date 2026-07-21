/**
 * Publishes canary (or "next") versions of all public Cedar packages to npm.
 *
 * Used in the publish-canary.yml GitHub Action workflow.
 *
 * Usage: node .github/scripts/publish-canary.mts
 * Environment variables required: NPM_AUTH_TOKEN, GITHUB_REF_NAME
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

interface PackageJson {
  name?: string
  version?: string
  private?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

interface WorkspaceInfo {
  name: string
  location: string
}

interface NpmTokenScope {
  name: string | null
  type: string
}

interface NpmTokenEntry {
  token: string
  expiry: string | null
  scopes: NpmTokenScope[]
}

const REPO_ROOT = process.cwd()

function log(message: string) {
  console.log(`• ${message}`)
}

function execCommand(command: string, cwd: string = REPO_ROOT): string {
  log(`Executing: ${command}`)

  try {
    return execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }).trim()
  } catch (error) {
    console.error(`❌ Command failed: ${command}`)
    throw error
  }
}

function isPackagePublished(packageName: string, version: string): boolean {
  try {
    execSync(`npm view ${packageName}@${version} version`, {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function getWorkspaces(): WorkspaceInfo[] {
  return execCommand('yarn workspaces list --json')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as WorkspaceInfo)
    .filter((ws) => ws.location !== '.')
}

function readPackageJson(pkgJsonPath: string): PackageJson {
  return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
}

function writePackageJson(pkgJsonPath: string, pkgJson: PackageJson) {
  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n')
}

function getValidCedarjsToken(): string | null {
  const tokens: NpmTokenEntry[] = JSON.parse(
    execCommand('npm token list --json'),
  )

  const now = new Date().toISOString()

  const validToken = tokens.find(
    (token) =>
      token.scopes?.some(
        (scope) => scope.name === 'cedarjs' && scope.type === 'org',
      ) &&
      (token.expiry === null || token.expiry > now),
  )

  return validToken?.token ?? null
}

// vX.Y.Z tags only, sorted ascending so the last entry is the newest
function getLatestVersionTag(): string | null {
  const tags = execCommand("git tag -l 'v*'")
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))

  tags.sort((a, b) => {
    const partsA = a.slice(1).split('.').map(Number)
    const partsB = b.slice(1).split('.').map(Number)

    for (let i = 0; i < 3; i++) {
      if (partsA[i] !== partsB[i]) {
        return partsA[i] - partsB[i]
      }
    }

    return 0
  })

  return tags.at(-1) ?? null
}

function updatePackageVersions(workspaces: WorkspaceInfo[], version: string) {
  log(`Updating package versions to ${version}`)

  for (const workspace of workspaces) {
    const pkgJsonPath = path.join(REPO_ROOT, workspace.location, 'package.json')

    if (!fs.existsSync(pkgJsonPath)) {
      throw new Error(`No package.json at ${workspace.location}/package.json`)
    }

    const pkgJson = readPackageJson(pkgJsonPath)
    pkgJson.version = version
    writePackageJson(pkgJsonPath, pkgJson)

    log(`  Updated ${workspace.location}/package.json`)
  }
}

function updateWorkspaceDependencies(
  workspaces: WorkspaceInfo[],
  version: string,
) {
  log(`Updating workspace:* dependencies to ${version}`)

  for (const workspace of workspaces) {
    const pkgJsonPath = path.join(REPO_ROOT, workspace.location, 'package.json')
    const pkgJson = readPackageJson(pkgJsonPath)

    for (const depField of ['dependencies', 'devDependencies'] as const) {
      const deps = pkgJson[depField]

      if (!deps) {
        continue
      }

      for (const [depName, depVersion] of Object.entries(deps)) {
        if (depVersion === 'workspace:*') {
          deps[depName] = version
        }
      }
    }

    writePackageJson(pkgJsonPath, pkgJson)
    log(`  Updated ${workspace.location}/package.json workspace deps`)
  }
}

function updateCreateCedarAppTemplates(version: string) {
  log(`Updating create-cedar-app templates to ${version}`)

  const createCedarAppDir = path.join(REPO_ROOT, 'packages/create-cedar-app')

  const pkgJsonFiles = fs.globSync(
    ['templates/**/package.json', 'database-overlays/**/package.json'],
    {
      cwd: createCedarAppDir,
      exclude: (filePath) => filePath.includes('node_modules'),
    },
  )

  for (const relativePath of pkgJsonFiles) {
    const pkgJsonPath = path.join(createCedarAppDir, relativePath)
    const pkgJson = readPackageJson(pkgJsonPath)

    for (const depField of ['dependencies', 'devDependencies'] as const) {
      const deps = pkgJson[depField]

      if (!deps) {
        continue
      }

      for (const depName of Object.keys(deps)) {
        if (depName.startsWith('@cedarjs/')) {
          deps[depName] = version
        }
      }
    }

    writePackageJson(pkgJsonPath, pkgJson)
    log(`  Updated ${path.basename(path.dirname(pkgJsonPath))}/package.json`)
  }
}

function publishPackages(workspaces: WorkspaceInfo[], tag: string) {
  log(`Publishing all packages with tag ${tag}`)

  for (const workspace of workspaces) {
    const pkgJsonPath = path.join(REPO_ROOT, workspace.location, 'package.json')
    const pkgJson = readPackageJson(pkgJsonPath)

    if (pkgJson.private) {
      log(`Skipping private package at ${workspace.location}`)
      continue
    }

    const packageName = pkgJson.name
    const packageVersion = pkgJson.version

    if (!packageName || !packageVersion) {
      throw new Error(`Missing name or version in ${pkgJsonPath}`)
    }

    log(`Publishing ${packageName}@${packageVersion}...`)

    if (isPackagePublished(packageName, packageVersion)) {
      log('  Already published, skipping')
      continue
    }

    execCommand(
      `npm publish --tag ${tag} --access public`,
      path.join(REPO_ROOT, workspace.location),
    )
    log(`  ✅ Published ${packageName}@${packageVersion}`)
  }
}

function main() {
  const npmAuthToken = process.env.NPM_AUTH_TOKEN

  if (!npmAuthToken) {
    throw new Error('NPM_AUTH_TOKEN is not set or is empty')
  }

  fs.writeFileSync(
    path.join(REPO_ROOT, '.npmrc'),
    `//registry.npmjs.org/:_authToken=${npmAuthToken}\n`,
  )

  // Make sure the token is valid and not expired
  log(`npm user: ${execCommand('npm whoami')}`)

  // Make sure the token is valid and not expired, and has "cedarjs" org
  // scope
  const validToken = getValidCedarjsToken()

  if (!validToken) {
    console.error(
      "Error: No valid, non-expired NPM token found for 'cedarjs' org scope",
    )
    throw new Error('No valid npm token found')
  }

  log("NPM token for 'cedarjs' org scope is valid and not expired")

  const githubRefName = process.env.GITHUB_REF_NAME || ''
  const tag = githubRefName === 'next' ? 'next' : 'canary'
  log(
    `Publishing ${tag} from ${githubRefName} using npm token ` +
      `${npmAuthToken.slice(0, 5)}`,
  )

  // ── Calculate version ────────────────────────────────────────────────────

  const latestTag = getLatestVersionTag()

  if (!latestTag) {
    throw new Error('No version tags (vX.Y.Z) found in the repository')
  }

  log(`Latest tag: ${latestTag}`)

  const currentVersion = latestTag.slice(1)
  log(`Current version: ${currentVersion}`)

  const commitCount = execCommand(`git rev-list --count ${latestTag}..HEAD`)
  log(`Commits since tag: ${commitCount}`)

  const [major, minor, patch] = currentVersion.split('.').map(Number)

  const baseVersion =
    githubRefName === 'main'
      ? `${major + 1}.0.0`
      : `${major}.${minor}.${patch + 1}`

  const canaryVersion = `${baseVersion}-${tag}.${commitCount}`
  log(`Canary version: ${canaryVersion}`)

  // ── Update all packages to canary version ────────────────────────────────

  const workspaces = getWorkspaces()

  updatePackageVersions(workspaces, canaryVersion)
  updateWorkspaceDependencies(workspaces, canaryVersion)
  updateCreateCedarAppTemplates(canaryVersion)

  // ── Commit the changes ───────────────────────────────────────────────────

  execCommand('git config user.name "GitHub Actions"')
  execCommand('git config user.email "<>"')
  execCommand(
    `git commit -am "Update packages and templates to canary version ${canaryVersion}"`,
  )

  // ── Publish all packages ─────────────────────────────────────────────────

  publishPackages(workspaces, tag)

  log('✅ Canary publishing completed successfully!')
}

try {
  main()
} catch (error) {
  console.error('❌ Canary publishing failed:')
  console.error(error)
  process.exit(1)
}
