#!/usr/bin/env node

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface WorkspaceInfo {
  name: string
  location: string
}

interface PackageJson {
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function run() {
  const version = process.argv[2]?.replace(/v/, '')

  if (!version) {
    console.error(
      'You have to provide a version.\n' +
        'Usage ./update-package-versions.mts <version>',
    )
    process.exitCode = 1
    return
  }

  const cwd = path.join(__dirname, '../')

  console.log(`Updating all packages to version ${version}`)
  console.log()

  // Get all workspace packages
  const workspacesOutput = execSync('yarn workspaces list --json', {
    cwd,
    encoding: 'utf-8',
  }).trim()

  const workspaces: WorkspaceInfo[] = workspacesOutput
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((ws) => ws.location !== '.')

  for (const workspace of workspaces) {
    const pkgJsonPath = path.join(cwd, workspace.location, 'package.json')
    const pkg: PackageJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))

    // Update the package's own version
    pkg.version = version

    // Update dependencies and devDependencies
    for (const deps of [pkg.dependencies, pkg.devDependencies]) {
      if (!deps) {
        continue
      }
      for (const dep of Object.keys(deps)) {
        if (dep.startsWith('@cedarjs/') || deps[dep] === 'workspace:*') {
          deps[dep] = version
        }
      }
    }

    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`  Updated ${workspace.location}/package.json`)
  }

  console.log()

  // Updates create-cedar-app template
  console.log('Updating create-cedar-app template...')
  const tsTemplatePath = path.join(
    cwd,
    'packages/create-cedar-app/templates/ts',
  )
  updateCedarPackagesVersion(tsTemplatePath, version)
  updateCedarPackagesVersion(path.join(tsTemplatePath, 'api'), version)
  updateCedarPackagesVersion(path.join(tsTemplatePath, 'web'), version)
  console.log()

  const jsTemplatePath = path.join(
    cwd,
    'packages/create-cedar-app/templates/js',
  )
  updateCedarPackagesVersion(jsTemplatePath, version)
  updateCedarPackagesVersion(path.join(jsTemplatePath, 'api'), version)
  updateCedarPackagesVersion(path.join(jsTemplatePath, 'web'), version)
  console.log()

  // Updates __fixtures__/test-project packages
  console.log('Updating test-project fixture...')
  const fixturePath = path.join(cwd, '__fixtures__/test-project')
  updateCedarPackagesVersion(fixturePath, version)
  updateCedarPackagesVersion(path.join(fixturePath, 'api'), version)
  updateCedarPackagesVersion(path.join(fixturePath, 'web'), version)
  console.log()
}

function updateCedarPackagesVersion(pkgPath: string, version: string) {
  const pkg: PackageJson = JSON.parse(
    fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf-8'),
  )

  for (const deps of [pkg.dependencies, pkg.devDependencies]) {
    if (!deps) {
      continue
    }

    for (const dep of Object.keys(deps).filter(isCedarPackage)) {
      console.log(` - ${dep}: ${deps[dep]} => ${version}`)
      deps[dep] = version
    }
  }

  fs.writeFileSync(
    path.join(pkgPath, 'package.json'),
    JSON.stringify(pkg, null, 2),
    'utf-8',
  )
}

const isCedarPackage = (pkg: string) => pkg.startsWith('@cedarjs/')

run()
