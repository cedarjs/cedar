import path from 'node:path'

import {
  setOutput,
  getInput,
  createExecWithEnvInCwd,
  execInFramework,
  CEDAR_FRAMEWORK_PATH,
} from '../actionsLibLocally.mts'

import { setUpTestProject } from './setUpTestProject.mts'

const testProjectPath = path.join(process.cwd(), 'ci-test-project')

setUpTestProject({
  setOutput,
  getInput,
  createExecWithEnvInCwd,
  execInFramework,
  cedarFrameworkPath: CEDAR_FRAMEWORK_PATH,
  testProjectPath,
})
