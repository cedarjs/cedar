import path from 'node:path'

import core from '@actions/core'

import {
  createExecWithEnvInCwd,
  execInFramework,
  CEDAR_FRAMEWORK_PATH,
} from '../actionsLib.mjs'

import { setUpTestProjectLive } from './setUpTestProjectLive.mts'

const parentDir = path.dirname(process.cwd())
// The space in the directory name is deliberate: it makes every CI run
// exercise paths with spaces, which catches missing shell quoting on all
// platforms (historically a Windows-breakage class we otherwise never test).
const testProjectPath = path.join(parentDir, 'test project live')

setUpTestProjectLive({
  setOutput: core.setOutput,
  createExecWithEnvInCwd,
  execInFramework,
  cedarFrameworkPath: CEDAR_FRAMEWORK_PATH,
  testProjectPath,
})
