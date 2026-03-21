import path from 'node:path'

import core from '@actions/core'

import {
  createExecWithEnvInCwd,
  execInFramework,
  CEDAR_FRAMEWORK_PATH,
} from '../actionsLib.mjs'

import { setUpTestProject } from './setUpTestProject.mts'

const parentDir = path.dirname(process.cwd())
const testProjectPath = path.join(parentDir, 'kitchen-sink-project')

setUpTestProject({
  setOutput: core.setOutput,
  getInput: core.getInput,
  createExecWithEnvInCwd,
  execInFramework,
  cedarFrameworkPath: CEDAR_FRAMEWORK_PATH,
  testProjectPath,
})
