/**
 * Removes orphaned `staging-*` dist-tags from the published packages.
 *
 * Publishing tags every package with `staging-<version>`, waits for the
 * registry to catch up, flips the real dist-tag over, then removes the staging
 * tag. A run that doesn't reach that last step leaves its staging tag behind on
 * every package it had already published.
 *
 * That happens routinely rather than exceptionally: the prerelease workflow
 * sets `cancel-in-progress`, so a second push to main kills the first publish
 * mid-flight, and a cancelled job can't run cleanup on its way out. They
 * accumulate until something removes them, and they bury the real tags in
 * `npm view` output.
 *
 * Removing a dist-tag does not unpublish anything. Every version stays exactly
 * where it is and remains installable by exact version -- only the alias goes.
 *
 * Environment variables required: NPM_AUTH_TOKEN
 */
import { execFile as execFileCb } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import util from 'node:util'

// execFile rather than exec: package and tag names come from the registry, so
// they must never be interpolated into a shell command line
const execFile = util.promisify(execFileCb)

const REPO_ROOT = process.cwd()
const REGISTRY = 'https://registry.npmjs.org'

const STAGING_TAG_PREFIX = 'staging-'

/**
 * Staging tags whose version was published more recently than this are left
 * alone, so a publish that's currently in flight never has the tag pulled out
 * from under it before it can flip. Publishes take minutes, so hours of slack
 * is plenty.
 */
const MIN_AGE_MS = 6 * 60 * 60 * 1000

/** Registry reads are cheap. Writes are rate limited, so they go narrower. */
const READ_CONCURRENCY = 12
const REMOVE_CONCURRENCY = 6

/**
 * Deadlines, so a stalled request or child process can't hold the whole run
 * open until the job-level timeout kills it hours later. A timeout is counted
 * as a failure like any other.
 */
const REGISTRY_TIMEOUT_MS = 30_000
const COMMAND_TIMEOUT_MS = 60_000

interface Packument {
  'dist-tags'?: Record<string, string>
  time?: Record<string, string>
}

interface StaleTag {
  packageName: string
  tag: string
}

interface ScanResult {
  tags: StaleTag[]
  /** False when the registry couldn't be read, as opposed to read fine with
   * nothing stale on it */
  ok: boolean
}

function log(message: string) {
  console.log(message)
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++
        results[index] = await fn(items[index])
      }
    },
  )

  await Promise.all(workers)

  return results
}

/** Every non-private workspace, i.e. everything that gets published */
async function getPublishablePackageNames(): Promise<string[]> {
  const { stdout } = await execFile('yarn', ['workspaces', 'list', '--json'], {
    cwd: REPO_ROOT,
    timeout: COMMAND_TIMEOUT_MS,
  })

  const locations: string[] = stdout
    .trim()
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { location: string })
    .map((workspace) => workspace.location)
    .filter((location) => location !== '.')

  const names: string[] = []

  for (const location of locations) {
    const pkgJsonPath = path.join(REPO_ROOT, location, 'package.json')

    if (!fs.existsSync(pkgJsonPath)) {
      continue
    }

    // Only optional-chained lookups are done on the parsed structure
    const pkgJson = JSON.parse(
      fs.readFileSync(pkgJsonPath, 'utf8'),
    ) as Partial<{ name: string; private: boolean }>

    if (pkgJson.private || !pkgJson.name) {
      continue
    }

    names.push(pkgJson.name)
  }

  return names
}

/**
 * Returns the staging tags on a package that are old enough to remove.
 *
 * A packument gives both the dist-tags and the publish time of every version,
 * so the age of a staging tag is the age of the version it points at.
 */
async function getStaleTags(packageName: string): Promise<ScanResult> {
  let response: Response

  try {
    response = await fetch(`${REGISTRY}/${packageName.replace('/', '%2F')}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`⚠️  Couldn't read ${packageName} (${message})`)

    return { tags: [], ok: false }
  }

  // A package that has never been published has nothing to clean up. That's a
  // successful read, not a failure
  if (response.status === 404) {
    return { tags: [], ok: true }
  }

  if (!response.ok) {
    log(`⚠️  Couldn't read ${packageName} (HTTP ${response.status})`)

    return { tags: [], ok: false }
  }

  const packument = (await response.json()) as Packument
  const distTags = packument['dist-tags'] ?? {}
  const times = packument.time ?? {}
  const now = Date.now()

  const tags = Object.keys(distTags)
    .filter((tag) => tag.startsWith(STAGING_TAG_PREFIX))
    .filter((tag) => {
      const publishedAt = times[distTags[tag]]

      // No timestamp means we can't tell how old it is. Leave it rather than
      // risk removing a tag from a publish that's still running
      if (!publishedAt) {
        return false
      }

      return now - new Date(publishedAt).getTime() > MIN_AGE_MS
    })
    .map((tag) => ({ packageName, tag }))

  return { tags, ok: true }
}

async function main() {
  const npmAuthToken = process.env.NPM_AUTH_TOKEN

  if (!npmAuthToken) {
    throw new Error('NPM_AUTH_TOKEN is not set or is empty')
  }

  // Into a temp dir rather than the repo root. `.npmrc` is neither tracked nor
  // gitignored, so a token written there is one `git add .` away from being
  // committed by anyone who runs this locally. Child npm processes pick this up
  // through the inherited environment.
  const npmrcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-npmrc-'))
  const npmrcPath = path.join(npmrcDir, '.npmrc')

  fs.writeFileSync(
    npmrcPath,
    `//registry.npmjs.org/:_authToken=${npmAuthToken}\n`,
  )
  process.env['npm_config_userconfig'] = npmrcPath

  try {
    await cleanUpStagingTags()
  } finally {
    // The token lives in here. On a runner the whole machine is thrown away,
    // but this also gets run locally
    fs.rmSync(npmrcDir, { recursive: true, force: true })
  }
}

async function cleanUpStagingTags() {
  const packageNames = await getPublishablePackageNames()
  log(`Checking ${packageNames.length} published packages`)

  const scans = await runWithConcurrency(
    packageNames,
    READ_CONCURRENCY,
    getStaleTags,
  )

  const unreadable = scans.filter((scan) => !scan.ok).length
  const staleTags = scans.flatMap((scan) => scan.tags)

  // Without this, a registry-wide outage or rate limit reads as "nothing to
  // clean up" and the job goes green having looked at nothing
  if (unreadable === packageNames.length) {
    throw new Error(
      `Couldn't read any of the ${packageNames.length} packages from the ` +
        'registry',
    )
  }

  if (unreadable > 0) {
    log(`⚠️  ${unreadable} package(s) couldn't be read and were skipped`)
  }

  // `npm dist-tag rm` removes whatever it's given, so make sure nothing that
  // isn't a staging tag can reach it -- getting this wrong would drop `latest`
  // off every package
  for (const { packageName, tag } of staleTags) {
    if (!tag.startsWith(STAGING_TAG_PREFIX)) {
      throw new Error(
        `Refusing to continue: '${tag}' on ${packageName} is not a staging ` +
          'tag but ended up on the removal list',
      )
    }
  }

  if (staleTags.length === 0) {
    log('✨ No staging dist-tags to remove')

    return
  }

  const distinctTags = new Set(staleTags.map(({ tag }) => tag))
  log(
    `Removing ${staleTags.length} staging dist-tag(s) across ` +
      `${distinctTags.size} version(s)`,
  )

  let removed = 0
  let failed = 0

  await runWithConcurrency(
    staleTags,
    REMOVE_CONCURRENCY,
    async ({ packageName, tag }) => {
      try {
        await execFile('npm', ['dist-tag', 'rm', packageName, tag], {
          cwd: REPO_ROOT,
          timeout: COMMAND_TIMEOUT_MS,
        })
        removed += 1
      } catch (error) {
        failed += 1

        const message = error instanceof Error ? error.message : String(error)
        log(`⚠️  Couldn't remove '${tag}' from ${packageName}: ${message}`)
      }
    },
  )

  log(`✨ Removed ${removed} staging dist-tag(s), ${failed} failed`)

  // Leftovers are harmless and the next run will try again, so a few failures
  // aren't worth failing the job over. A total wipeout usually means the token
  // expired, which is worth being loud about
  if (removed === 0 && failed > 0) {
    throw new Error('Every removal failed. Is NPM_AUTH_TOKEN still valid?')
  }
}

main()
