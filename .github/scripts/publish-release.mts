/**
 * Publishes a stable Cedar release (vX.Y.Z) to npm.
 *
 * Runs from the publish.yml workflow when a `vX.Y.Z` tag is pushed. The
 * tagged commit is prepared by the release tooling
 * (https://github.com/cedarjs/release-tooling) and already has every
 * package's version bumped, in-monorepo dependencies pinned, and the
 * create-cedar-app templates (including their lockfiles) pointing at the new
 * version. So there's no version math here. This script only verifies that
 * the tree really is in that state and then publishes it.
 *
 * Publishing happens in two phases, same as the prerelease script:
 *
 * 1. Every public package is published under a `staging-<version>` dist-tag.
 *    Nothing resolves that tag, so a slow or failed publish is invisible to
 *    users.
 * 2. Once every package is confirmed to be on the registry, the real dist-tag
 *    (`latest`, or `patch` for a patch to an older major) is pointed at the
 *    new version for every package, with create-cedar-app last so that
 *    `yarn create cedar-app` keeps scaffolding a self-consistent release until
 *    all the @cedarjs packages are promoted.
 *
 * Re-running after a failure is safe: already published versions are skipped
 * and the flip is idempotent.
 *
 * Usage: node .github/scripts/publish-release.mts [--dry-run]
 * Environment variables: RELEASE_TAG (e.g. v6.1.0). Authentication is npm
 * trusted publishing (OIDC) in CI, or NPM_AUTH_TOKEN as a fallback.
 * `--dry-run` runs every check and `npm publish --dry-run`, and doesn't
 * change any dist-tags.
 */

import { exec as execCb, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import util from 'node:util'

import {
  createNpmAuth,
  hasNpmCredentials,
  isOidcAvailable,
} from './lib/npm-auth.mts'
import type { NpmAuth } from './lib/npm-auth.mts'

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
] as const

interface PackageJson {
  name?: string
  version?: string
  private?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  [key: string]: unknown
}

interface WorkspaceInfo {
  name: string
  location: string
}

interface PublishablePackage {
  name: string
  version: string
  location: string
}

const REPO_ROOT = process.cwd()
const CREATE_CEDAR_APP_DIR = path.join(REPO_ROOT, 'packages/create-cedar-app')
const CREATE_CEDAR_APP_NAME = 'create-cedar-app'
const REGISTRY = 'https://registry.npmjs.org'

const exec = util.promisify(execCb)

const isDryRun = process.argv.includes('--dry-run')

// Publishes upload a tarball so they're heavier; dist-tag flips are cheap
// metadata calls. Kept modest to avoid tripping npm's registry rate limits.
const PUBLISH_CONCURRENCY = 4
const DIST_TAG_CONCURRENCY = 6

/** How long to wait for the registry to serve every published version */
const REGISTRY_PROPAGATION_TIMEOUT_MS = 5 * 60 * 1000

function log(message: string) {
  const prefix = isDryRun ? '[DRY-RUN]' : '•'
  console.log(`${prefix} ${message}`)
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
    const { stderr } = error as Error & { stderr?: string }
    return { message: error.message, stderr: stderr ?? '' }
  }

  return { message: String(error), stderr: '' }
}

async function execCommandAsync(
  command: string,
  {
    cwd = REPO_ROOT,
    env = process.env,
  }: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  log(`Executing: ${command}`)

  try {
    const { stdout } = await exec(command, { cwd, env, encoding: 'utf-8' })
    return stdout.trim()
  } catch (error) {
    const { message, stderr } = getExecErrorDetails(error)
    console.error(`❌ Command failed: ${command}`)
    console.error(stderr || message)
    throw error
  }
}

// Rate limiting and other transient/network errors, as opposed to a
// definitive rejection like "cannot publish over previously published
// version" or a failing prepublish build, which retrying won't fix. Anchored
// on npm's own error lines (`npm error code E429`, `npm error 503 Service
// Unavailable - PUT ...`) rather than any bare 3-digit number, which would
// also match digits in file paths and timestamps.
const TRANSIENT_NPM_ERROR_PATTERN =
  /npm error code E(429|5\d\d)\b|npm error (429|5\d\d) |ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i

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
      await setTimeout(delay)
    }
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++
      await worker(items[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      runNext(),
    ),
  )
}

function readPackageJson(pkgJsonPath: string): PackageJson {
  return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
}

function getWorkspaces(): WorkspaceInfo[] {
  return execCommand('yarn workspaces list --json')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as WorkspaceInfo)
    .filter((ws) => ws.location !== '.')
}

// ── Pre-flight checks ───────────────────────────────────────────────────────

function getReleaseVersion(): string {
  const tag = process.env.RELEASE_TAG

  if (!tag) {
    throw new Error('RELEASE_TAG is not set (expected something like v6.1.0)')
  }

  const match = /^v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))$/.exec(tag)

  if (!match) {
    throw new Error(
      `RELEASE_TAG must be a stable version tag like v6.1.0, got: ${tag}`,
    )
  }

  return match[1]
}

/**
 * The checkout must be exactly the tagged commit. Publishing anything else
 * under a release version would make provenance point at a commit that
 * doesn't match what's on npm.
 */
function assertHeadIsTag(tag: string) {
  const headSha = execCommand('git rev-parse HEAD')
  const tagSha = execCommand(`git rev-parse ${tag}^{commit}`)

  if (headSha !== tagSha) {
    throw new Error(
      `HEAD (${headSha}) is not the commit tagged ${tag} (${tagSha})`,
    )
  }

  log(`✅ HEAD is ${tag} (${headSha})`)
}

/**
 * The release tooling is responsible for putting the tree in a publishable
 * state before tagging. This double-checks its work before anything reaches
 * npm: every workspace is at `version`, every in-monorepo dependency points
 * at `version`, and the create-cedar-app templates pin `version`.
 */
function verifyVersions(workspaces: WorkspaceInfo[], version: string) {
  log(`Verifying every package and in-monorepo dependency is at ${version}`)

  const workspaceNames = new Set(workspaces.map((ws) => ws.name))
  const problems: string[] = []

  for (const workspace of workspaces) {
    const pkgJsonPath = path.join(REPO_ROOT, workspace.location, 'package.json')
    const pkgJson = readPackageJson(pkgJsonPath)

    if (pkgJson.version !== version) {
      problems.push(`${workspace.name} has version ${pkgJson.version}`)
    }

    for (const depField of DEPENDENCY_FIELDS) {
      const deps = pkgJson[depField]

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

  const templatePkgJsonFiles = fs.globSync(
    ['templates/**/package.json', 'database-overlays/**/package.json'],
    {
      cwd: CREATE_CEDAR_APP_DIR,
      exclude: (filePath) => filePath.includes('node_modules'),
    },
  )

  for (const relativePath of templatePkgJsonFiles) {
    const pkgJson = readPackageJson(
      path.join(CREATE_CEDAR_APP_DIR, relativePath),
    )

    for (const depField of ['dependencies', 'devDependencies'] as const) {
      const deps = pkgJson[depField]

      if (!deps) {
        continue
      }

      for (const [depName, depVersion] of Object.entries(deps)) {
        if (workspaceNames.has(depName) && depVersion !== version) {
          problems.push(
            `create-cedar-app/${relativePath} ${depField}.${depName} is ` +
              depVersion,
          )
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Expected everything to be at ${version}, but found:\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    )
  }

  log(`✅ Everything is at ${version}`)
}

function getPublishablePackages(
  workspaces: WorkspaceInfo[],
): PublishablePackage[] {
  const publishable: PublishablePackage[] = []

  for (const workspace of workspaces) {
    const pkgJsonPath = path.join(REPO_ROOT, workspace.location, 'package.json')
    const pkgJson = readPackageJson(pkgJsonPath)

    if (pkgJson.private) {
      log(`Skipping private package ${workspace.name}`)
      continue
    }

    const { name, version } = pkgJson

    if (!name || !version) {
      throw new Error(`Missing name or version in ${pkgJsonPath}`)
    }

    publishable.push({ name, version, location: workspace.location })
  }

  return publishable
}

// ── Registry reads ──────────────────────────────────────────────────────────

interface Packument {
  'dist-tags'?: Record<string, string>
  versions?: Record<string, unknown>
}

/**
 * Reads straight from the registry rather than through `npm view`, which
 * goes through npm's cache and can report a version as missing for a while
 * after it was published. A 404 means the package has never been published.
 */
async function fetchPackument(packageName: string): Promise<Packument | null> {
  const response = await fetch(
    `${REGISTRY}/${packageName.replace('/', '%2F')}`,
    {
      headers: {
        accept:
          'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8',
      },
      signal: AbortSignal.timeout(30_000),
    },
  )

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(
      `Fetching ${packageName} from the registry failed with HTTP ` +
        response.status,
    )
  }

  return (await response.json()) as Packument
}

async function isPublished(packageName: string, version: string) {
  const packument = await withRetry(() => fetchPackument(packageName))

  return Boolean(packument?.versions?.[version])
}

async function getDistTagVersion(
  packageName: string,
  distTag: string,
): Promise<string | null> {
  const packument = await withRetry(() => fetchPackument(packageName))

  return packument?.['dist-tags']?.[distTag] ?? null
}

/**
 * `latest` unless this is a patch to an older major line, in which case
 * `latest` has to stay on the newer major and the release goes out as
 * `patch` instead. Mirrors `getDistTagForRelease` in the release tooling.
 */
async function getDistTagForRelease(version: string): Promise<string> {
  const currentLatest = await getDistTagVersion('@cedarjs/core', 'latest')

  if (!currentLatest) {
    return 'latest'
  }

  const majorOf = (v: string) => Number(v.split('.')[0])

  return majorOf(version) < majorOf(currentLatest) ? 'patch' : 'latest'
}

/**
 * Trusted publishing can't create packages. A workspace that has never been
 * published needs a first manual publish (with a token) before the release,
 * so fail before anything is published rather than halfway through.
 */
async function assertAllPackagesExistOnNpm(packages: PublishablePackage[]) {
  log('Checking that every package already exists on npm')

  const missing: string[] = []

  await runWithConcurrency(packages, 8, async (pkg) => {
    if ((await withRetry(() => fetchPackument(pkg.name))) === null) {
      missing.push(pkg.name)
    }
  })

  if (missing.length > 0) {
    throw new Error(
      'These packages have never been published, and trusted publishing ' +
        'cannot create new packages. Publish a first version manually, and ' +
        'configure a trusted publisher for it, before releasing:\n' +
        missing.map((name) => `  - ${name}`).join('\n'),
    )
  }

  log('✅ All packages exist on npm')
}

async function waitForPackagesOnNpm(packages: PublishablePackage[]) {
  log(`Waiting for ${packages.length} packages to be served by the registry`)

  const deadline = Date.now() + REGISTRY_PROPAGATION_TIMEOUT_MS
  let pending = [...packages]

  while (pending.length > 0) {
    const stillPending: PublishablePackage[] = []

    await runWithConcurrency(pending, 8, async (pkg) => {
      if (!(await isPublished(pkg.name, pkg.version))) {
        stillPending.push(pkg)
      }
    })

    pending = stillPending

    if (pending.length === 0) {
      break
    }

    if (Date.now() > deadline) {
      throw new Error(
        'Timed out waiting for the registry to serve:\n' +
          pending.map((pkg) => `  - ${pkg.name}@${pkg.version}`).join('\n'),
      )
    }

    log(`  ${pending.length} package(s) not visible yet, waiting...`)
    await setTimeout(5_000)
  }

  log('✅ All packages are available on npm')
}

// ── Registry writes ─────────────────────────────────────────────────────────

async function publishPackagesToStagingTag(
  packages: PublishablePackage[],
  stagingTag: string,
  auth: NpmAuth | null,
) {
  log(`Publishing ${packages.length} packages under staging tag ${stagingTag}`)

  // With trusted publishing npm adds provenance on its own. Asking for it
  // explicitly makes a token-based publish from CI do the same, and turns a
  // silent downgrade into a loud failure.
  const provenanceFlag = isOidcAvailable() ? ' --provenance' : ''
  const dryRunFlag = isDryRun ? ' --dry-run' : ''

  await runWithConcurrency(packages, PUBLISH_CONCURRENCY, async (pkg) => {
    // A dry run still packs every package, even ones already on npm, so that
    // a dry run of an already-published tag exercises the real path.
    if (!isDryRun && (await isPublished(pkg.name, pkg.version))) {
      log(`  ${pkg.name}@${pkg.version} already published, skipping`)
      return
    }

    await withRetry(async () =>
      execCommandAsync(
        `npm publish --tag ${stagingTag} --access public` +
          `${provenanceFlag}${dryRunFlag}`,
        {
          cwd: path.join(REPO_ROOT, pkg.location),
          env: auth ? await auth.forPublish(pkg.name) : process.env,
        },
      ),
    )

    log(
      `  ✅ Published ${pkg.name}@${pkg.version} (staging tag: ${stagingTag})`,
    )
  })
}

async function addDistTag(pkg: PublishablePackage, tag: string, auth: NpmAuth) {
  await withRetry(async () =>
    execCommandAsync(`npm dist-tag add ${pkg.name}@${pkg.version} ${tag}`, {
      env: await auth.forDistTag(pkg.name),
    }),
  )
}

/**
 * Points `finalTag` at the new version for every package. npm has no
 * cross-package transaction, so if this fails partway the packages that
 * already flipped are rolled back to whatever `finalTag` pointed at before,
 * converging on a consistent (if old) state rather than a mix.
 */
async function flipToFinalTag(
  packages: PublishablePackage[],
  finalTag: string,
  auth: NpmAuth,
) {
  log(
    `Pointing '${finalTag}' at the new version for ${packages.length} packages`,
  )

  if (isDryRun) {
    log('Dry-run: not touching dist-tags')
    return
  }

  const previousVersions = new Map<string, string | null>()
  const flipped: PublishablePackage[] = []

  try {
    await runWithConcurrency(packages, DIST_TAG_CONCURRENCY, async (pkg) => {
      previousVersions.set(
        pkg.name,
        await getDistTagVersion(pkg.name, finalTag),
      )
      await addDistTag(pkg, finalTag, auth)
      flipped.push(pkg)
      log(`  🏷 ${pkg.name}@${pkg.version} -> ${finalTag}`)
    })
  } catch (error) {
    console.error(
      `❌ Flipping to ${finalTag} failed after ${flipped.length}/` +
        `${packages.length} packages. Rolling back the ones that already ` +
        'flipped so the registry does not end up in a mixed-version state.',
    )
    await rollBackFlips(flipped, finalTag, previousVersions, auth)
    throw error
  }
}

async function rollBackFlips(
  flipped: PublishablePackage[],
  finalTag: string,
  previousVersions: Map<string, string | null>,
  auth: NpmAuth,
) {
  await runWithConcurrency(flipped, DIST_TAG_CONCURRENCY, async (pkg) => {
    const previousVersion = previousVersions.get(pkg.name)

    if (!previousVersion) {
      console.error(
        `  ⚠️ No previous version recorded for ${pkg.name}, leaving it on ` +
          `${finalTag} = ${pkg.version}. Manual check required.`,
      )
      return
    }

    try {
      await addDistTag({ ...pkg, version: previousVersion }, finalTag, auth)
      log(`  ↩️ Rolled back ${pkg.name} to ${previousVersion}`)
    } catch {
      console.error(
        `  ⚠️ Failed to roll back ${pkg.name}. It is still pointing at ` +
          `${finalTag} = ${pkg.version}. Manual intervention required.`,
      )
    }
  })
}

/**
 * Best-effort. Leftover staging tags are harmless (the nightly cleanup job
 * removes them) so failures here aren't fatal.
 */
async function removeStagingTag(
  packages: PublishablePackage[],
  stagingTag: string,
  auth: NpmAuth,
) {
  log(`Cleaning up staging tag ${stagingTag}`)

  if (isDryRun) {
    log('Dry-run: not touching dist-tags')
    return
  }

  await runWithConcurrency(packages, DIST_TAG_CONCURRENCY, async (pkg) => {
    try {
      await execCommandAsync(`npm dist-tag rm ${pkg.name} ${stagingTag}`, {
        env: await auth.forDistTag(pkg.name),
      })
    } catch {
      log(`  Could not remove staging tag from ${pkg.name}, ignoring`)
    }
  })
}

/**
 * A dry run never writes a dist-tag, so it would pass without ever finding
 * out whether the credentials can. This re-points `latest` for one package
 * at the version it already points at: a real, authenticated write that
 * changes nothing.
 */
async function smokeTestDistTagAuth(auth: NpmAuth) {
  const packageName = '@cedarjs/core'
  const currentLatest = await getDistTagVersion(packageName, 'latest')

  if (!currentLatest) {
    log(`Skipping dist-tag auth check: ${packageName} has no 'latest' tag`)
    return
  }

  log(`Checking dist-tag auth (${auth.mode}) with a no-op write`)
  await addDistTag(
    { name: packageName, version: currentLatest, location: '' },
    'latest',
    auth,
  )
  log('✅ dist-tag auth works')
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const version = getReleaseVersion()
  const tag = `v${version}`

  log(`Publishing release ${tag}`)

  assertHeadIsTag(tag)

  const workspaces = getWorkspaces()
  verifyVersions(workspaces, version)

  const allPackages = getPublishablePackages(workspaces)
  const cedarPackages = allPackages.filter(
    (pkg) => pkg.name !== CREATE_CEDAR_APP_NAME,
  )
  const ccaPackages = allPackages.filter(
    (pkg) => pkg.name === CREATE_CEDAR_APP_NAME,
  )

  if (ccaPackages.length !== 1) {
    throw new Error(
      `Expected exactly one ${CREATE_CEDAR_APP_NAME} workspace, found ` +
        ccaPackages.length,
    )
  }

  await assertAllPackagesExistOnNpm(allPackages)

  const distTag = await getDistTagForRelease(version)
  const stagingTag = `staging-${version}`

  log(`Release dist-tag: ${distTag}`)

  // A dry run can be done without any credentials (e.g. locally). `npm
  // publish --dry-run` doesn't need them, and no dist-tags are written.
  const auth = isDryRun && !hasNpmCredentials() ? null : createNpmAuth()
  log(`npm auth mode: ${auth?.mode ?? 'none (dry-run without credentials)'}`)

  try {
    if (isDryRun && auth) {
      await smokeTestDistTagAuth(auth)
    }

    await publishPackagesToStagingTag(allPackages, stagingTag, auth)

    if (isDryRun) {
      log('Dry-run: skipping the registry availability wait')
      return
    }

    if (!auth) {
      throw new Error('Unreachable: publishing for real without credentials')
    }

    await waitForPackagesOnNpm(allPackages)

    // create-cedar-app last, so `yarn create cedar-app` keeps scaffolding the
    // previous, self-consistent release until every @cedarjs package has
    // been promoted.
    await flipToFinalTag(cedarPackages, distTag, auth)
    await flipToFinalTag(ccaPackages, distTag, auth)

    await removeStagingTag(allPackages, stagingTag, auth)
  } finally {
    auth?.dispose()
  }

  log(`🎉 Release ${tag} published under '${distTag}'`)
}

main().catch((error) => {
  console.error('❌ Release publishing failed:')
  console.error(error)
  process.exit(1)
})
