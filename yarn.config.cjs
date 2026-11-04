/* eslint-env node */
// @ts-check

const fs = require('node:fs')
const path = require('node:path')

const semver = require('semver')

const {
  getCatalogs,
  isCatalogRange,
  resolveCatalogRange,
} = require('./tasks/catalogs.cjs')
const { getCurrentGitBranch } = require('./tasks/git-hooks/git-branch.cjs')

/**
 * @typedef {import('@yarnpkg/types').Yarn.Constraints.Context} Context
 * @typedef {import('@yarnpkg/types').Yarn.Constraints.Workspace} Workspace
 */

/** @type {import('@yarnpkg/types')} */
const { defineConfig } = require(`@yarnpkg/types`)

/**
 * Vite depends on esbuild. For consistency, we should always use the same
 * version of esbuild as Vite.
 *
 * @param {Context} ctx
 */
async function enforceEsbuildMatchesVite({ Yarn }) {
  // Find the first workspace that declares vite
  let viteWorkspace = null
  let viteVersion = null

  for (const workspace of Yarn.workspaces()) {
    const deps = workspace.manifest.dependencies || {}
    const devDeps = workspace.manifest.devDependencies || {}

    if (deps.vite || devDeps.vite) {
      viteWorkspace = workspace
      viteVersion = resolveCatalogRange('vite', deps.vite || devDeps.vite)
      break
    }
  }

  if (!viteWorkspace || !viteVersion) {
    // No vite declared in any workspace; nothing to enforce
    return
  }

  // Use Node's module resolution to find the actual vite package.json being used
  // This works regardless of where Yarn placed vite in node_modules
  let vitePackageJson = null
  let vitePackageJsonPath = null

  try {
    vitePackageJsonPath = require.resolve('vite/package.json', {
      paths: [path.join(process.cwd(), viteWorkspace.cwd)],
    })
    vitePackageJson = JSON.parse(fs.readFileSync(vitePackageJsonPath, 'utf-8'))
  } catch (e) {
    // Failed to resolve or read vite's package.json
  }

  if (!vitePackageJson) {
    // Can't find vite's package.json, so we can't enforce this constraint
    console.warn(
      'Warning: Could not find vite package.json to enforce esbuild version constraint',
    )
    return
  }

  // Verify that the resolved vite version matches what was declared
  let resolvedViteVersion = vitePackageJson.version
  if (!semver.satisfies(resolvedViteVersion, viteVersion)) {
    // Version mismatch - try fallback locations
    const fallbackPaths = []

    // Fallback 1: node_modules/vite/package.json (if not already checked)
    const rootVitePath = path.join(
      process.cwd(),
      'node_modules',
      'vite',
      'package.json',
    )
    if (vitePackageJsonPath !== rootVitePath) {
      fallbackPaths.push(rootVitePath)
    }

    // Fallback 2: node_modules/<workspace-name>/node_modules/vite/package.json
    const workspaceName = viteWorkspace.manifest.name
    if (workspaceName) {
      const workspaceVitePath = path.join(
        process.cwd(),
        'node_modules',
        workspaceName,
        'node_modules',
        'vite',
        'package.json',
      )
      if (vitePackageJsonPath !== workspaceVitePath) {
        fallbackPaths.push(workspaceVitePath)
      }
    }

    // Try each fallback path
    let foundMatch = false
    for (const fallbackPath of fallbackPaths) {
      if (fs.existsSync(fallbackPath)) {
        try {
          const fallbackPackageJson = JSON.parse(
            fs.readFileSync(fallbackPath, 'utf-8'),
          )
          const fallbackVersion = fallbackPackageJson.version
          if (semver.satisfies(fallbackVersion, viteVersion)) {
            vitePackageJson = fallbackPackageJson
            vitePackageJsonPath = fallbackPath
            resolvedViteVersion = fallbackVersion
            foundMatch = true
            break
          }
        } catch (e) {
          // Failed to read this fallback, continue to next
        }
      }
    }

    if (!foundMatch) {
      console.warn(
        `Warning: Resolved vite version (${resolvedViteVersion}) does not ` +
          `satisfy declared version (${viteVersion})`,
      )
    }
  }

  // Get the esbuild version that vite depends on
  const viteEsbuildVersion =
    vitePackageJson.dependencies?.esbuild ||
    vitePackageJson.devDependencies?.esbuild ||
    vitePackageJson.optionalDependencies?.esbuild

  if (!viteEsbuildVersion) {
    // Vite doesn't declare esbuild dependency, nothing to enforce
    return
  }

  // Check all workspaces that declare esbuild
  const violations = []

  for (const workspace of Yarn.workspaces()) {
    const deps = workspace.manifest.dependencies || {}
    const devDeps = workspace.manifest.devDependencies || {}
    const peerDeps = workspace.manifest.peerDependencies || {}

    const declaredRange = deps.esbuild || devDeps.esbuild || peerDeps.esbuild

    if (!declaredRange) {
      continue
    }

    const declaredEsbuild = resolveCatalogRange('esbuild', declaredRange)

    // Check if the declared esbuild version satisfies vite's esbuild version
    // range
    // I wanted to use === here, but vite doesn't declare an exact version, and
    // Cedar always does, so we use semver.satisfies instead.
    const satisfies = semver.satisfies(declaredEsbuild, viteEsbuildVersion)

    if (!satisfies) {
      violations.push({
        workspace: workspace.cwd,
        declared: declaredEsbuild,
        viteExpects: viteEsbuildVersion,
      })
    }
  }

  if (violations.length > 0) {
    const lines = [
      `esbuild / vite constraint failed: some workspaces declare an esbuild ` +
        `version that doesn't satisfy what vite requires.`,
      '',
      `Vite (${vitePackageJson.version}) uses esbuild: ${viteEsbuildVersion}`,
      '',
      ...violations.flatMap((v) => [
        `- workspace: ${v.workspace}`,
        `  declared esbuild: ${v.declared}`,
        `  vite requires: ${v.viteExpects}`,
        '',
      ]),
    ]

    throw new Error(lines.join('\n'))
  }
}

/**
 * This rule will enforce that a workspace MUST depend on the same version of a
 * dependency as the one used by the other workspaces.
 *
 * @param {Context} context
 */
function enforceConsistentDependenciesAcrossTheProject({ Yarn }) {
  const { catalog } = getCatalogs()

  for (const dependency of Yarn.dependencies()) {
    // enforceSinglePrismaVersion and enforceCatalogForSharedDependencies set
    // the range for these
    if (
      dependency.type === `peerDependencies` ||
      isPrismaReleasePackage(dependency.ident) ||
      catalog[dependency.ident]
    ) {
      continue
    }

    for (const otherDependency of Yarn.dependencies({
      ident: dependency.ident,
    })) {
      if (otherDependency.type === `peerDependencies`) {
        continue
      }

      if (
        (dependency.type === `devDependencies` ||
          otherDependency.type === `devDependencies`) &&
        Yarn.workspace({ ident: otherDependency.ident })
      ) {
        continue
      }

      dependency.update(otherDependency.range)
    }
  }
}

/**
 * This rule will enforce that workspace dependencies use `workspace:*` as the
 * dependency range instead of a specific version (like 0.7.1)
 *
 * @param {Context} context
 */
function enforceWorkspaceDependenciesWhenPossible({ Yarn }) {
  for (const dependency of Yarn.dependencies()) {
    if (!Yarn.workspace({ ident: dependency.ident })) {
      continue
    }

    dependency.update(`workspace:*`)
  }
}

/**
 * This rule will enforce that published (non-private) workspaces declare exact
 * versions.
 *
 * Every `dependencies` entry must be an exact version (like `1.2.3` or
 * `1.2.3-rc.4`) or `workspace:*`. A `catalog:` range counts as the version
 * the catalog has for it. A `peerDependencies` entry must also be
 * exact or `workspace:*`, unless it's marked optional in
 * `peerDependenciesMeta`. Optional peers belong to opt-in features that the
 * app installs and upgrades itself via a setup command, so they use a range;
 * an exact version would make the package manager warn on every user-side
 * bump.
 *
 * `@babel/core` is the exception and uses a caret range in `dependencies`.
 * Many packages apps install (Storybook, for one) depend on it with a range,
 * and a range lets the package manager install a single shared copy instead
 * of nesting Cedar's own copy next to a newer one.
 *
 * @param {Context} context
 */
function enforceExactVersionsInPublishedWorkspaces({ Yarn }) {
  const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
  const rangeAllowed = new Set(['@babel/core'])

  /** @param {import('@yarnpkg/types').Yarn.Constraints.Dependency} dependency */
  const isPinned = ({ ident, range }) =>
    range === 'workspace:*' ||
    exactVersion.test(resolveCatalogRange(ident, range))

  for (const workspace of Yarn.workspaces()) {
    if (workspace.manifest.private) {
      continue
    }

    for (const dependency of Yarn.dependencies({
      workspace,
      type: 'dependencies',
    })) {
      if (rangeAllowed.has(dependency.ident)) {
        continue
      }

      if (!isPinned(dependency)) {
        dependency.error(
          `The dependency '${dependency.ident}' must use an exact version or ` +
            `'workspace:*', not '${dependency.range}'`,
        )
      }
    }

    const peerDependenciesMeta = workspace.manifest.peerDependenciesMeta || {}

    for (const dependency of Yarn.dependencies({
      workspace,
      type: 'peerDependencies',
    })) {
      if (peerDependenciesMeta[dependency.ident]?.optional) {
        continue
      }

      if (!isPinned(dependency)) {
        dependency.error(
          `The peer dependency '${dependency.ident}' must use an exact ` +
            `version or 'workspace:*', not '${dependency.range}'. Only ` +
            `optional peer dependencies may use a range`,
        )
      }
    }
  }
}

/**
 * This rule will enforce that a dependency doesn't appear in both
 * `dependencies` and `devDependencies`.
 *
 * @param {Context} context
 */
function enforceNotProdAndDevDependencies({ Yarn }) {
  for (const workspace of Yarn.workspaces()) {
    const dependencies = Yarn.dependencies({ workspace, type: 'dependencies' })
    const devDependencies = Yarn.dependencies({
      workspace,
      type: 'devDependencies',
    })
    for (const dependency of dependencies) {
      if (
        devDependencies.find(
          (devDependency) => devDependency.ident === dependency.ident,
        )
      ) {
        dependency.error(
          `The dependency '${dependency.ident}' should not appear in both dependencies and devDependencies`,
        )
      }
    }
  }
}

/**
 * This rule will enforce that `graphql` resolves to exactly one version across
 * the entire dependency graph (both workspace and transitive deps).
 *
 * It reads `yarn.lock` and counts the number of lockfile entries whose key
 * contains `graphql@npm:`.  If there is more than one, different parts of the
 * module graph resolve to different copies, which causes duplicate installs
 * under pnpm. graphql is a singleton package. If more than one version is in
 * use, the instanceof checks within graphql itself fail at runtime because the
 * two copies are separate module instances, breaking GraphQL execution.
 */
function enforceSingleGraphqlVersion() {
  const lockfilePath = path.join(__dirname, 'yarn.lock')

  if (!fs.existsSync(lockfilePath)) {
    return
  }

  const content = fs.readFileSync(lockfilePath, 'utf-8')
  const lines = content.split('\n')

  /** @type {{ key: string, line: number }[]} */
  const entries = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Match top-level lockfile keys, e.g.:
    //   "graphql@npm:16.13.2":
    //   "graphql@npm:14 - 16, graphql@npm:16.14.2, graphql@npm:^16.0.0":
    if (/^"(?:graphql@npm:[^"]*)(?:,\s*graphql@npm:[^"]*)*":\s*$/.test(line)) {
      entries.push({ key: line, line: i + 1 })
    }
  }

  if (entries.length <= 1) {
    return
  }

  const details = entries.map((e) => `  line ${e.line}: ${e.key}`).join('\n')

  throw new Error(
    `graphql resolves to multiple versions in the lockfile. This will cause ` +
      `duplicate installs under pnpm.\n\n${details}\n\n` +
      `Ensure all workspace and transitive dependencies resolve to the same ` +
      `graphql version.`,
  )
}

/**
 * `@prisma/*` packages with their own version line, separate from the
 * `prisma` CLI release version
 */
const INDEPENDENTLY_VERSIONED_PRISMA_PACKAGES = new Set([
  '@prisma/dev',
  '@prisma/engines-version',
  '@prisma/studio-core',
])

/**
 * @param {string} ident
 */
function isPrismaReleasePackage(ident) {
  return (
    ident === 'prisma' ||
    (ident.startsWith('@prisma/') &&
      !INDEPENDENTLY_VERSIONED_PRISMA_PACKAGES.has(ident))
  )
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function findPackageJsonFiles(dir) {
  if (!fs.existsSync(dir)) {
    return []
  }

  /** @type {string[]} */
  const files = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') {
      continue
    }

    const entryPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...findPackageJsonFiles(entryPath))
    } else if (entry.name === 'package.json') {
      files.push(entryPath)
    }
  }

  return files
}

/**
 * This rule will enforce that `prisma` and all `@prisma/*` packages released
 * together with it use one exact version, across all workspaces (dependencies,
 * devDependencies and peerDependencies) and the create-cedar-app templates.
 *
 * Apps install the only copy of `prisma` and `@prisma/client`, and Cedar
 * declares them as pinned peer dependencies. Prisma packages on different
 * versions install duplicate copies of Prisma and its engines in apps, and
 * produce peer dependency warnings.
 *
 * The version lives in the `prisma` catalog in `.yarnrc.yml`. Every entry in
 * that catalog has the same version, and workspace dependencies and
 * devDependencies refer to it with `catalog:prisma`. Peer dependencies and
 * the create-cedar-app templates spell the version out, and it has to match
 * the catalog. `@cedarjs/cli`'s `prisma` peer dependency is the version
 * `yarn cedar upgrade` sets in apps.
 *
 * @param {Context} context
 */
function enforceSinglePrismaVersion({ Yarn }) {
  const prismaCatalog = getCatalogs().catalogs.prisma ?? {}
  const prismaVersion = prismaCatalog.prisma

  if (!prismaVersion) {
    throw new Error(
      'Prisma version constraint failed: .yarnrc.yml must have a `prisma` ' +
        'catalog with a `prisma` entry',
    )
  }

  const mismatchedEntries = Object.entries(prismaCatalog).filter(
    ([, version]) => version !== prismaVersion,
  )

  if (mismatchedEntries.length > 0) {
    throw new Error(
      'Prisma version constraint failed: every entry in the `prisma` catalog ' +
        `in .yarnrc.yml must be ${prismaVersion}, the version of \`prisma\`:\n\n` +
        mismatchedEntries
          .map(([ident, version]) => `  ${ident}: ${version}`)
          .join('\n'),
    )
  }

  for (const dependency of Yarn.dependencies()) {
    // enforcePeerDependenciesMatchCatalogs sets the version of peers
    if (
      !isPrismaReleasePackage(dependency.ident) ||
      dependency.type === 'peerDependencies'
    ) {
      continue
    }

    if (prismaCatalog[dependency.ident]) {
      dependency.update('catalog:prisma')
    } else {
      dependency.error(
        `${dependency.ident} is released together with Prisma. Add it to ` +
          'the `prisma` catalog in .yarnrc.yml and use `catalog:prisma`',
      )
    }
  }

  const createCedarAppDir = path.join(__dirname, 'packages', 'create-cedar-app')
  const templateFiles = [
    ...findPackageJsonFiles(path.join(createCedarAppDir, 'templates')),
    ...findPackageJsonFiles(path.join(createCedarAppDir, 'database-overlays')),
  ]

  /** @type {string[]} */
  const violations = []

  for (const file of templateFiles) {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf-8'))

    for (const type of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
    ]) {
      for (const [ident, range] of Object.entries(manifest[type] || {})) {
        if (isPrismaReleasePackage(ident) && range !== prismaVersion) {
          violations.push(
            `  ${path.relative(__dirname, file)}: ${type}.${ident} is ` +
              `${range}`,
          )
        }
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Prisma version constraint failed: create-cedar-app templates must ` +
        `use the Prisma version from the \`prisma\` catalog in .yarnrc.yml ` +
        `(${prismaVersion}).\n\n${violations.join('\n')}`,
    )
  }
}

/**
 * This rule will enforce that a dependency used by two or more workspaces gets
 * its version from the default catalog in `.yarnrc.yml`, as `catalog:`, so a
 * version bump changes one line in `.yarnrc.yml` instead of every
 * `package.json` that uses it. A dependency that is in the catalog always
 * uses `catalog:`, however many workspaces use it.
 *
 * This covers `dependencies` and `devDependencies`. Yarn rewrites `catalog:`
 * in `peerDependencies` to `*` on install, so peer dependencies spell their
 * version out (see `enforcePeerDependenciesMatchCatalogs`). Prisma packages
 * use the `prisma` catalog (see `enforceSinglePrismaVersion`).
 *
 * @param {Context} context
 */
function enforceCatalogForSharedDependencies({ Yarn }) {
  const { catalog } = getCatalogs()

  /** @type {Map<string, Set<string>>} */
  const workspacesByIdent = new Map()

  for (const dependency of Yarn.dependencies()) {
    if (
      dependency.type === 'peerDependencies' ||
      Yarn.workspace({ ident: dependency.ident }) ||
      isPrismaReleasePackage(dependency.ident)
    ) {
      continue
    }

    const workspaces = workspacesByIdent.get(dependency.ident) ?? new Set()
    workspaces.add(dependency.workspace.cwd)
    workspacesByIdent.set(dependency.ident, workspaces)
  }

  for (const dependency of Yarn.dependencies()) {
    const workspaces = workspacesByIdent.get(dependency.ident)

    if (!workspaces || dependency.type === 'peerDependencies') {
      continue
    }

    if (catalog[dependency.ident]) {
      dependency.update('catalog:')
    } else if (workspaces.size > 1) {
      dependency.error(
        `'${dependency.ident}' is used by ${workspaces.size} workspaces. Add ` +
          'it to the `catalog` in .yarnrc.yml and use `catalog:` in each of ' +
          'them',
      )
    }
  }
}

/**
 * This rule will enforce that an exact peer dependency on a package that is
 * in a catalog uses the version from that catalog: the `prisma` catalog for
 * Prisma packages, the default catalog for everything else.
 *
 * Peer dependencies can't use `catalog:`, because Yarn rewrites it to `*` on
 * install, and `yarn pack` would then publish `*`. `yarn constraints --fix`
 * updates the peers after a catalog bump. Peer dependencies on a range (like
 * `^7.0.0`) are left alone.
 *
 * @param {Context} context
 */
function enforcePeerDependenciesMatchCatalogs({ Yarn }) {
  const { catalog, catalogs } = getCatalogs()
  const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

  for (const dependency of Yarn.dependencies({ type: 'peerDependencies' })) {
    const catalogVersion = isPrismaReleasePackage(dependency.ident)
      ? catalogs.prisma?.[dependency.ident]
      : catalog[dependency.ident]

    if (!catalogVersion) {
      continue
    }

    if (isCatalogRange(dependency.range) || dependency.range === '*') {
      dependency.error(
        `The peer dependency '${dependency.ident}' must spell out its ` +
          `version (${catalogVersion}). Yarn rewrites \`catalog:\` peer ` +
          'dependencies to `*`',
      )
    } else if (exactVersion.test(dependency.range)) {
      dependency.update(catalogVersion)
    }
  }
}

/**
 * This rule will enforce that the specified fields are present in the
 * `package.json` of all workspaces.
 *
 * @param {Context} context
 * @param {string[]} fields
 */
function enforceFieldsOnAllWorkspaces({ Yarn }, fields) {
  for (const workspace of Yarn.workspaces()) {
    // Skip the root workspace
    if (workspace.cwd === '.') {
      continue
    }

    for (const field of fields) {
      if (!workspace.manifest[field]) {
        workspace.error(
          `The field '${field}' is required in the package.json of '${workspace.cwd}'`,
        )
      }
    }
  }
}

/**
 * This rule will enforce that the specified fields are present in the
 * `package.json` of all workspaces and that they have the expected value.
 *
 * @param {Context} context
 * @param {Record<string, ((workspace: Workspace) => any) | string>} fields
 */
function enforceFieldsWithValuesOnAllWorkspaces({ Yarn }, fields) {
  for (const workspace of Yarn.workspaces()) {
    // Skip the root workspace
    if (workspace.cwd === '.') {
      continue
    }

    for (const [field, value] of Object.entries(fields)) {
      workspace.set(
        field,
        typeof value === `function` ? value(workspace) : value,
      )
    }
  }
}

module.exports = defineConfig({
  constraints: async (ctx) => {
    const branch = getCurrentGitBranch()

    enforceConsistentDependenciesAcrossTheProject(ctx)
    enforceCatalogForSharedDependencies(ctx)
    enforcePeerDependenciesMatchCatalogs(ctx)
    if (branch !== 'next' && !branch?.startsWith('release/')) {
      enforceWorkspaceDependenciesWhenPossible(ctx)
    }
    enforceNotProdAndDevDependencies(ctx)
    enforceExactVersionsInPublishedWorkspaces(ctx)
    enforceSingleGraphqlVersion()
    enforceSinglePrismaVersion(ctx)
    enforceFieldsOnAllWorkspaces(ctx, [
      'name',
      'version',
      // 'description', // TODO(jgmw): Add description to all packages and uncomment this line
    ])
    enforceFieldsWithValuesOnAllWorkspaces(ctx, {
      license: 'MIT',
      ['repository.type']: 'git',
      ['repository.url']: 'git+https://github.com/cedarjs/cedar.git',
      ['repository.directory']: (workspace) => workspace.cwd,
    })

    await enforceEsbuildMatchesVite(ctx)
  },
})
