/* eslint-env node */
// @ts-check

const fs = require('node:fs')
const path = require('node:path')

const semver = require('semver')

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
      viteVersion = deps.vite || devDeps.vite
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

    const declaredEsbuild = deps.esbuild || devDeps.esbuild || peerDeps.esbuild

    if (!declaredEsbuild) {
      continue
    }

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
  for (const dependency of Yarn.dependencies()) {
    if (dependency.type === `peerDependencies`) {
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
 * This rule will enforce that any package built with babel (identified by the
 * presence of a 'build:js' script in its `package.json`) must depend on the
 * '@babel/runtime-corejs3' and 'core-js' packages.
 *
 * @param {Context} context
 */
function enforceBabelDependencies({ Yarn }) {
  for (const workspace of Yarn.workspaces()) {
    const packageJson = workspace.manifest
    if (!packageJson.scripts?.[`build:js`]) {
      continue
    }

    const dependencies = Yarn.dependencies({
      workspace,
      type: 'dependencies',
    })
    const requiredDependencies = [`@babel/runtime-corejs3`, `core-js`]
    for (const dependency of requiredDependencies) {
      if (!dependencies.find((dep) => dep.ident === dependency)) {
        workspace.error(
          `The package '${workspace.cwd}' must depend on '${dependency}' to build with babel`,
        )
      }
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
    const branch = await gitBranch()

    enforceConsistentDependenciesAcrossTheProject(ctx)
    if (branch !== 'next' && !branch?.startsWith('release/')) {
      enforceWorkspaceDependenciesWhenPossible(ctx)
    }
    enforceNotProdAndDevDependencies(ctx)
    enforceBabelDependencies(ctx)
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

function gitBranch() {
  function parseBranch(buf) {
    const match = /ref: refs\/heads\/([^\n]+)/.exec(buf.toString())
    return match ? match[1] : null
  }

  function findGitHead(startDir = process.cwd()) {
    let currentDir = path.resolve(startDir)
    let foundGitHeadPath

    while (!foundGitHeadPath) {
      const gitHeadPath = path.join(currentDir, '.git', 'HEAD')

      if (fs.existsSync(gitHeadPath)) {
        foundGitHeadPath = gitHeadPath
      } else {
        const parentDir = path.dirname(currentDir)

        if (parentDir === currentDir) {
          throw new Error('.git/HEAD does not exist')
        }

        currentDir = parentDir
      }
    }

    return foundGitHeadPath
  }

  const promise = fs.promises
    .readFile(findGitHead())
    .then((buf) => parseBranch(buf))

  return promise
}
