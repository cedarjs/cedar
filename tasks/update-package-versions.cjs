#!/usr/bin/env node
/* eslint-env node */

const child = require('child_process')
const fs = require('node:fs')
const path = require('node:path')

async function run() {
  const version = process.argv[2].replace(/v/, '')

  if (!version) {
    console.error(
      'You have to provide a version.\n' +
        'Usage ./update-package-versions.cjs <version>',
    )
    process.exitCode = 1
    return
  }

  const cwd = path.join(__dirname, '../')

  console.log(`Updating all packages to version ${version}`)
  console.log()

  // Get all workspace packages
  const workspacesOutput = child
    .execSync('yarn workspaces list --json', { cwd, encoding: 'utf-8' })
    .toString()
    .trim()

  const workspaces = workspacesOutput
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((ws) => ws.location !== '.')

  for (const workspace of workspaces) {
    const pkgJsonPath = path.join(cwd, workspace.location, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))

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
  updateRWJSPkgsVersion(tsTemplatePath, version)
  updateRWJSPkgsVersion(path.join(tsTemplatePath, 'api'), version)
  updateRWJSPkgsVersion(path.join(tsTemplatePath, 'web'), version)
  console.log()

  const jsTemplatePath = path.join(
    cwd,
    'packages/create-cedar-app/templates/js',
  )
  updateRWJSPkgsVersion(jsTemplatePath, version)
  updateRWJSPkgsVersion(path.join(jsTemplatePath, 'api'), version)
  updateRWJSPkgsVersion(path.join(jsTemplatePath, 'web'), version)
  console.log()

  // Updates __fixtures__/test-project packages
  console.log('Updating test-project fixture...')
  const fixturePath = path.join(cwd, '__fixtures__/test-project')
  updateRWJSPkgsVersion(fixturePath, version)
  updateRWJSPkgsVersion(path.join(fixturePath, 'api'), version)
  updateRWJSPkgsVersion(path.join(fixturePath, 'web'), version)
  console.log()
}

function updateRWJSPkgsVersion(pkgPath, version) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf-8'),
  )

  for (const dep of Object.keys(pkg.dependencies ?? {}).filter(isRWJSPkg)) {
    console.log(` - ${dep}: ${pkg.dependencies[dep]} => ${version}`)
    pkg.dependencies[dep] = `${version}`
  }

  for (const dep of Object.keys(pkg.devDependencies ?? {}).filter(isRWJSPkg)) {
    console.log(` - ${dep}: ${pkg.devDependencies[dep]} => ${version}`)
    pkg.devDependencies[dep] = `${version}`
  }

  fs.writeFileSync(
    path.join(pkgPath, 'package.json'),
    JSON.stringify(pkg, null, 2),
    'utf-8',
  )
}

const isRWJSPkg = (pkg) => pkg.startsWith('@cedarjs/')

run()
