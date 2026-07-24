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
    esm: { type: 'boolean', default: false },
  },
})

const fixture = values.esm ? 'test-project-esm' : 'test-project'
const dirName = values.esm ? 'ci-test-project-esm' : 'ci-test-project'
const testProjectPath = path.join(process.cwd(), dirName)

setUpTestProject({
  setOutput,
  getInput,
  createExecWithEnvInCwd,
  execInFramework,
  cedarFrameworkPath: CEDAR_FRAMEWORK_PATH,
  testProjectPath,
  packageManager: optionalPackageManager(values.packageManager),
  fixture,
})
