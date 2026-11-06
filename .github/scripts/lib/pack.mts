/**
 * Building, packing and checking packages for the publish scripts.
 *
 * Packages are packed with `yarn pack` and the tarball is uploaded with
 * `npm publish <tarball>`. `yarn pack` resolves the Yarn-only version
 * protocols (`workspace:`, `catalog:`) to real versions, which `npm publish`
 * run in a package directory doesn't understand. `npm publish` then uploads
 * with trusted publishing (OIDC), provenance and dist-tags as usual.
 *
 * Neither `yarn pack` nor `npm publish <tarball>` builds anything, so the
 * publish scripts build with `buildPackages()` after bumping versions and
 * before packing. Some builds bundle the package's own version (e.g.
 * create-cedar-app's `--version`), so the build has to come after the bump.
 *
 * Every tarball goes through `assertTarballIsPublishable()` before anything
 * is uploaded. A dependency left on a Yarn-only protocol, or a `main`,
 * `exports` or `bin` entry that points at a file the tarball doesn't
 * contain, makes that version uninstallable, and a published version can't
 * be replaced.
 */
import { exec as execCb, execFileSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

const exec = util.promisify(execCb)

/** Every manifest field `assertTarballIsPublishable()` checks versions in */
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

/**
 * Version protocols that only mean something inside this repo. npm, pnpm
 * and Yarn in another project can't resolve any of them.
 */
const LOCAL_ONLY_PROTOCOLS = [
  'catalog:',
  'workspace:',
  'portal:',
  'link:',
  'file:',
]

// npm puts everything in a tarball under this directory
const TARBALL_ROOT = 'package/'

export interface PackTarget {
  name: string
  version: string
  /** The workspace directory, absolute or relative to the repo root */
  location: string
}

export interface PackedPackage extends PackTarget {
  /** Absolute path to the tarball */
  tarball: string
}

interface TarballManifest {
  name?: unknown
  version?: unknown
  main?: unknown
  module?: unknown
  types?: unknown
  typings?: unknown
  bin?: unknown
  exports?: unknown
  [key: string]: unknown
}

/**
 * Runs `NODE_ENV=production yarn build` in `cwd`. In the repo root, Nx
 * builds every workspace in dependency order; in a package directory, it
 * builds that package.
 */
export function buildPackages(cwd: string) {
  console.log(`• Building ${cwd} for publishing`)

  execSync('yarn build', {
    cwd,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'inherit',
  })
}

function tarballFileName({ name, version }: PackTarget) {
  return `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`
}

async function packOne(
  target: PackTarget,
  repoRoot: string,
  outDir: string,
): Promise<PackedPackage> {
  const tarball = path.join(outDir, tarballFileName(target))

  try {
    await exec(`yarn pack --out "${tarball}"`, {
      cwd: path.resolve(repoRoot, target.location),
      encoding: 'utf-8',
    })
  } catch (error) {
    console.error(`❌ yarn pack failed for ${target.name}`)

    if (error instanceof Error) {
      // `exec` attaches the output to the error; Yarn reports to stdout
      const { stdout } = error as Error & { stdout?: string }
      console.error(stdout || error.message)
    }

    throw error
  }

  assertTarballIsPublishable(tarball, target)

  return { ...target, tarball }
}

/**
 * Packs every target into `outDir` and checks every tarball. Throws on the
 * first package that fails, before any tarball is uploaded, so call this for
 * all packages before publishing any of them.
 */
export async function packPackages(
  targets: PackTarget[],
  { repoRoot, outDir }: { repoRoot: string; outDir: string },
): Promise<Map<string, PackedPackage>> {
  console.log(`• Packing ${targets.length} packages into ${outDir}`)
  fs.mkdirSync(outDir, { recursive: true })

  const results: PackedPackage[] = new Array(targets.length)
  let nextIndex = 0

  async function runNext(): Promise<void> {
    while (nextIndex < targets.length) {
      const index = nextIndex++
      results[index] = await packOne(targets[index], repoRoot, outDir)
    }
  }

  // Packing is mostly disk work; a few at once keeps it quick
  await Promise.all(
    Array.from({ length: Math.min(4, targets.length) }, () => runNext()),
  )

  // In the same order as `targets`, whatever order the packing finished in
  const packed = new Map(results.map((pkg) => [pkg.name, pkg]))

  console.log(`• ✅ Packed and checked ${packed.size} packages`)

  return packed
}

function readTarball(tarball: string) {
  const files = new Set(
    execFileSync('tar', ['-tzf', tarball], { encoding: 'utf-8' })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith(TARBALL_ROOT))
      .map((line) => line.slice(TARBALL_ROOT.length))
      .filter((line) => line && !line.endsWith('/')),
  )

  const manifest: unknown = JSON.parse(
    execFileSync('tar', ['-xzOf', tarball, `${TARBALL_ROOT}package.json`], {
      encoding: 'utf-8',
    }),
  )

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`${tarball} has no package.json object`)
  }

  // Narrowed to a plain object above. Every field is still `unknown` and is
  // type-checked where it's read
  return { files, manifest: manifest as TarballManifest }
}

/** `./dist/index.js` and `dist/index.js` both become `dist/index.js` */
function normalizeTarget(target: string) {
  return path.posix.normalize(target).replace(/^\.\//, '')
}

/**
 * Every file path an `exports` value can point at. Conditions and subpaths
 * are walked recursively; `null` (an excluded subpath) points at nothing.
 */
function collectExportTargets(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectExportTargets)
  }

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectExportTargets)
  }

  return []
}

function hasMatchingFile(files: Set<string>, target: string) {
  const normalized = normalizeTarget(target)

  if (!normalized.includes('*')) {
    return files.has(normalized)
  }

  // A subpath pattern like `./dist/*.js`: at least one file has to match
  const pattern = new RegExp(
    '^' +
      normalized
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.+') +
      '$',
  )

  return [...files].some((file) => pattern.test(file))
}

/** `main` resolves like a CommonJS require: with or without an extension */
function hasMainFile(files: Set<string>, main: string) {
  const normalized = normalizeTarget(main)

  return [
    normalized,
    `${normalized}.js`,
    `${normalized}.json`,
    `${normalized}/index.js`,
  ].some((candidate) => files.has(candidate))
}

/**
 * Throws, listing every problem, unless the tarball is safe to publish as
 * `expected.name@expected.version`:
 *
 * - its package.json has that name and version
 * - no dependency uses a version protocol that only works inside this repo
 *   (`catalog:`, `workspace:`, ...)
 * - every file `main`, `module`, `types`, `typings`, `bin` and `exports`
 *   point at is in the tarball
 */
export function assertTarballIsPublishable(
  tarball: string,
  expected: Pick<PackTarget, 'name' | 'version'>,
) {
  const { files, manifest } = readTarball(tarball)
  const problems: string[] = []

  if (manifest.name !== expected.name) {
    problems.push(`name is ${String(manifest.name)}, expected ${expected.name}`)
  }

  if (manifest.version !== expected.version) {
    problems.push(
      `version is ${String(manifest.version)}, expected ${expected.version}`,
    )
  }

  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field]

    if (!deps || typeof deps !== 'object') {
      continue
    }

    for (const [depName, range] of Object.entries(deps)) {
      if (
        typeof range === 'string' &&
        LOCAL_ONLY_PROTOCOLS.some((protocol) => range.startsWith(protocol))
      ) {
        problems.push(`${field}.${depName} is "${range}"`)
      }
    }
  }

  if (typeof manifest.main === 'string' && !hasMainFile(files, manifest.main)) {
    problems.push(`main points at ${manifest.main}, which isn't in the tarball`)
  }

  for (const field of ['module', 'types', 'typings'] as const) {
    const target = manifest[field]

    if (typeof target === 'string' && !hasMatchingFile(files, target)) {
      problems.push(`${field} points at ${target}, which isn't in the tarball`)
    }
  }

  const binTargets =
    typeof manifest.bin === 'string'
      ? [manifest.bin]
      : manifest.bin && typeof manifest.bin === 'object'
        ? Object.values(manifest.bin).filter(
            (target): target is string => typeof target === 'string',
          )
        : []

  for (const target of binTargets) {
    if (!hasMatchingFile(files, target)) {
      problems.push(`bin points at ${target}, which isn't in the tarball`)
    }
  }

  for (const target of collectExportTargets(manifest.exports)) {
    // Only relative targets are files in this package
    if (target.startsWith('./') && !hasMatchingFile(files, target)) {
      problems.push(`exports points at ${target}, which isn't in the tarball`)
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `${expected.name}@${expected.version} (${tarball}) can't be ` +
        'published:\n' +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    )
  }
}
