import path from 'node:path'

import core from '@actions/core'

import {
  createExecWithEnvInCwd,
  execInFramework,
  CEDAR_FRAMEWORK_PATH,
} from '../actionsLib.mjs'

import { setUpTestProjectLive } from './setUpTestProjectLive.mts'

const parentDir = path.dirname(process.cwd())
const testProjectPath = path.join(parentDir, 'test-project-live')

setUpTestProjectLive({
  setOutput: core.setOutput,
  getInput: core.getInput,
  createExecWithEnvInCwd,
  execInFramework,
  cedarFrameworkPath: CEDAR_FRAMEWORK_PATH,
  testProjectPath,
})
