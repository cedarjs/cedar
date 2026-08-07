#!/usr/bin/env node
/* eslint-env node */
// @ts-check

import path from 'node:path'

import { addDependenciesToPackageJson } from './lib/project.mjs'

function main() {
  const projectPath =
    process.argv?.[2] ?? process.env.CEDAR_CWD ?? process.env.RWJS_CWD

  if (!projectPath) {
    process.exitCode = 1
    console.error([
      'Error: Please specify the path to your Redwood project',
      `Usage: ${process.argv?.[1]} ./path/to/cedar/project`,
    ])
    return
  }

  try {
    const packageJsonPath = path.join(projectPath, 'package.json')
    addDependenciesToPackageJson(packageJsonPath)
    console.log('Done. Now run `yarn install`.')
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.log('Error:', message)
    process.exitCode = 1
  }
}

main()
