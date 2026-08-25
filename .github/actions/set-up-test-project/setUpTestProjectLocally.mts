import path from 'node:path'
import { parseArgs } from 'node:util'

import {
  setOutput,
  getInput,
  createExecWithEnvInCwd,
  execInFramework,
  CEDAR_FRAMEWORK_PATH,
} from '../actionsLibLocally.mts'

import {
  optionalPackageManager,
  setUpTestProject,
} from './setUpTestProject.mts'

const { values } = parseArgs({
  options: {
    packageManager: { type: 'string', short: 'p', default: 'yarn' },
  },
})

const testProjectPath = path.join(process.cwd(), 'ci-test-project')

setUpTestProject({
  setOutput,
  getInput,
  createExecWithEnvInCwd,
  execInFramework,
  cedarFrameworkPath: CEDAR_FRAMEWORK_PATH,
  testProjectPath,
  packageManager: optionalPackageManager(values.packageManager),
})
