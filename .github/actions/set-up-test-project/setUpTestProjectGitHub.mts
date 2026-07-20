import path from 'node:path'

import core from '@actions/core'

import type { PackageManager } from '@cedarjs/project-config/packageManager'

import {
  createExecWithEnvInCwd,
  execInFramework,
  CEDAR_FRAMEWORK_PATH,
} from '../actionsLib.mjs'

import { setUpTestProject } from './setUpTestProject.mts'

const parentDir = path.dirname(process.cwd())
// The space in the directory name is deliberate: it makes every CI run
// exercise paths with spaces, which catches missing shell quoting on all
// platforms (historically a Windows-breakage class we otherwise never test).
const testProjectPath = path.join(parentDir, 'test project')

setUpTestProject({
  setOutput: core.setOutput,
  getInput: core.getInput,
  createExecWithEnvInCwd,
  execInFramework,
  cedarFrameworkPath: CEDAR_FRAMEWORK_PATH,
  testProjectPath,
  packageManager: optionalPackageManager(core.getInput('packageManager')),
})

function optionalPackageManager(pm: string): PackageManager | undefined {
  if (pm !== 'yarn' && pm !== 'npm' && pm !== 'pnpm') {
    return undefined
  }

  return pm
}
