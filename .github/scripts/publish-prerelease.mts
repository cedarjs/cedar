/**
 * Publishes canary (or "next") versions of all public Cedar packages to npm.
 *
 * Packages are first published in parallel under a staging dist-tag unique
 * to the version being published. Only once every package has been published
 * under that staging tag do we flip each package's dist-tag over to the real
 * "canary" or "next" tag (also in parallel). This avoids a race where a
 * consumer (e.g. `yarn cedar upgrade -t canary`) resolves the "canary" tag to
 * a version that isn't fully published across all packages yet.
 *
 * Used in the publish-prerelease.yml GitHub Action workflow.
 *
 * Usage: node .github/scripts/publish-prerelease.mts
 * Environment variables required: NPM_AUTH_TOKEN, GITHUB_REF_NAME
 */

import { exec as execCb, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

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

const exec = util.promisify(execCb)

// How many `npm publish` / `npm dist-tag` calls to run concurrently. Publishes
// upload a tarball so they're heavier; dist-tag flips are cheap metadata
// calls. Kept modest to avoid tripping npm's registry rate limits.
const PUBLISH_CONCURRENCY = 4
const DIST_TAG_CONCURRENCY = 8

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

function getExecErrorDetails(error: unknown): {
  message: string
  stderr: string
} {
  if (error instanceof Error) {
    // Node's promisified child_process.exec attaches stdout/stderr to the
    // rejected error object; they aren't part of the Error type, so we read
    // them defensively through a narrow local shape.
    const { stderr } = error as Error & { stderr?: string }
    return { message: error.message, stderr: stderr ?? '' }
  }

  return { message: String(error), stderr: '' }
}

async function execCommandAsync(command: string, cwd: string = REPO_ROOT) {
  try {
    const { stdout } = await exec(command, { cwd, encoding: 'utf-8' })
    return stdout.trim()
  } catch (error) {
    const { message, stderr } = getExecErrorDetails(error)
    console.error(`❌ Command failed: ${command}`)
    if (stderr) {
      console.error(stderr)
    } else {
      console.error(message)
    }
    throw error
  }
}

// Matches rate-limiting and other transient/network errors from npm — as
// opposed to a definitive rejection like "404 not found" or "cannot publish
// over previously published version", which retrying won't fix.
const TRANSIENT_NPM_ERROR_PATTERN =
  /\b(429|5\d\d)\b|too many requests|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN/i

async function withRetry<T>(
  fn: () => Promise<T>,
  {
    retries = 5,
    baseDelayMs = 1500,
  }: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let attempt = 0

  for (;;) {
    try {
      return await fn()
    } catch (error) {
      attempt++
      const { message, stderr } = getExecErrorDetails(error)
      const isTransient = TRANSIENT_NPM_ERROR_PATTERN.test(
        `${message}\n${stderr}`,
      )

      if (!isTransient || attempt > retries) {
        throw error
      }

      const delay =
        baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 500)
      log(
        `  Transient npm error, retrying in ${delay}ms (attempt ${attempt}/${retries})...`,
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

// Runs `worker` over `items` with at most `concurrency` in flight at once.
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let nextIndex = 0

  async function runNext(): Promise<void> {
    let currentIndex = nextIndex
    nextIndex++

    while (currentIndex < items.length) {
      await worker(items[currentIndex], currentIndex)
      currentIndex = nextIndex
      nextIndex++
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      runNext(),
    ),
  )
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

interface PublishablePackage {
  workspace: WorkspaceInfo
  name: string
  version: string
}

function getPublishablePackages(
  workspaces: WorkspaceInfo[],
): PublishablePackage[] {
  const publishable: PublishablePackage[] = []

  for (const workspace of workspaces) {
    const pkgJsonPath = path.join(REPO_ROOT, workspace.location, 'package.json')
    const pkgJson = readPackageJson(pkgJsonPath)

    if (pkgJson.private) {
      log(`Skipping private package at ${workspace.location}`)
      continue
    }

    const { name, version } = pkgJson

    if (!name || !version) {
      throw new Error(`Missing name or version in ${pkgJsonPath}`)
    }

    publishable.push({ workspace, name, version })
  }

  return publishable
}

async function isPackagePublished(
  packageName: string,
  version: string,
): Promise<boolean> {
  try {
    await withRetry(() => exec(`npm view ${packageName}@${version} version`))
    return true
  } catch (error) {
    const { message, stderr } = getExecErrorDetails(error)

    // A transient error (rate limit, timeout, 5xx) here doesn't mean the
    // version is unpublished — treating it as "not published" would trigger
    // a duplicate `npm publish` that fails with a confusing error instead of
    // the real, transient one.
    if (TRANSIENT_NPM_ERROR_PATTERN.test(`${message}\n${stderr}`)) {
      throw error
    }

    return false
  }
}

// Publishes every public package under a staging tag unique to the version
// being published, in parallel (bounded by PUBLISH_CONCURRENCY). Nothing else
// in the registry references this tag, so partially-completed runs are
// invisible to consumers watching the real "canary"/"next" tag.
async function publishPackagesToStagingTag(
  packages: PublishablePackage[],
  stagingTag: string,
): Promise<void> {
  log(`Publishing ${packages.length} packages under staging tag ${stagingTag}`)

  await runWithConcurrency(packages, PUBLISH_CONCURRENCY, async (pkg) => {
    const { name, version, workspace } = pkg

    if (await isPackagePublished(name, version)) {
      log(`  ${name}@${version} already published, skipping`)
      return
    }

    await withRetry(() =>
      execCommandAsync(
        `npm publish --tag ${stagingTag} --access public`,
        path.join(REPO_ROOT, workspace.location),
      ),
    )
    log(`  ✅ Published ${name}@${version} (staging tag: ${stagingTag})`)
  })
}

// Best-effort lookup of what a tag currently points to for a package, used to
// roll back a partially-completed flip. Returns null if the package/tag has
// no prior version (e.g. a brand new package), or if the lookup itself fails.
async function getCurrentTagVersion(
  packageName: string,
  tagName: string,
): Promise<string | null> {
  try {
    const { stdout } = await exec(
      `npm view ${packageName} dist-tags.${tagName}`,
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

// Flips every package's dist-tag from the staging tag over to the real tag,
// in parallel (bounded by DIST_TAG_CONCURRENCY). This is the point at which
// the new version becomes visible to anything resolving the "canary"/"next"
// tag, and it only happens once every package above has published
// successfully.
//
// npm has no cross-package transaction, so this can't be made fully atomic:
// if one package's flip fails after retries (or the job is cancelled
// mid-flight), some packages will already point at the new version. To avoid
// leaving that new/old mix in place, a failure here rolls the
// already-flipped packages back to whatever version the tag pointed to
// before this run — converging back to a single consistent (if outdated)
// state rather than a partial one.
async function flipToFinalTag(
  packages: PublishablePackage[],
  finalTag: string,
): Promise<void> {
  log(`Flipping ${packages.length} packages to tag ${finalTag}`)

  const previousVersions = new Map<string, string | null>()
  const flipped: PublishablePackage[] = []

  try {
    await runWithConcurrency(packages, DIST_TAG_CONCURRENCY, async (pkg) => {
      const { name, version } = pkg

      previousVersions.set(name, await getCurrentTagVersion(name, finalTag))

      await withRetry(() =>
        execCommandAsync(`npm dist-tag add ${name}@${version} ${finalTag}`),
      )
      flipped.push(pkg)
      log(`  🏷 ${name}@${version} -> ${finalTag}`)
    })
  } catch (error) {
    console.error(
      `❌ Flipping to ${finalTag} failed after ${flipped.length}/` +
        `${packages.length} packages succeeded. Rolling back the ones that ` +
        `already flipped so the registry doesn't end up in a mixed-version ` +
        `state.`,
    )
    await rollBackFlips(flipped, finalTag, previousVersions)
    throw error
  }
}

async function rollBackFlips(
  flipped: PublishablePackage[],
  finalTag: string,
  previousVersions: Map<string, string | null>,
): Promise<void> {
  await runWithConcurrency(flipped, DIST_TAG_CONCURRENCY, async (pkg) => {
    const previousVersion = previousVersions.get(pkg.name)

    if (!previousVersion) {
      console.error(
        `  ⚠️ No previous version recorded for ${pkg.name} — leaving it on ` +
          `${finalTag} = ${pkg.version}. Manual check required.`,
      )
      return
    }

    try {
      await execCommandAsync(
        `npm dist-tag add ${pkg.name}@${previousVersion} ${finalTag}`,
      )
      log(`  ↩️ Rolled back ${pkg.name} to ${previousVersion}`)
    } catch {
      console.error(
        `  ⚠️ Failed to roll back ${pkg.name} — it is still pointing at ` +
          `${finalTag} = ${pkg.version}. Manual intervention required.`,
      )
    }
  })
}

// Best-effort cleanup of the staging tag now that the final tag points at
// the same version. Failures here don't affect the published packages, so
// they're not fatal.
async function removeStagingTag(
  packages: PublishablePackage[],
  stagingTag: string,
): Promise<void> {
  log(`Cleaning up staging tag ${stagingTag}`)

  await runWithConcurrency(packages, DIST_TAG_CONCURRENCY, async (pkg) => {
    try {
      await execCommandAsync(`npm dist-tag rm ${pkg.name} ${stagingTag}`)
    } catch {
      log(`  Could not remove staging tag for ${pkg.name}, ignoring`)
    }
  })
}

async function main() {
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

  // ── Publish all packages under a staging tag, then flip to the real tag ──

  const packages = getPublishablePackages(workspaces)
  const stagingTag = `staging-${canaryVersion}`

  await publishPackagesToStagingTag(packages, stagingTag)
  await flipToFinalTag(packages, tag)
  await removeStagingTag(packages, stagingTag)

  log('✅ Canary publishing completed successfully!')
}

main().catch((error) => {
  console.error('❌ Canary publishing failed:')
  console.error(error)
  process.exit(1)
})
