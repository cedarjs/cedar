import os from 'node:os'
import path from 'node:path'

import {
  createExecWithEnvInCwd,
  setOutput,
  setUpRscTestProject,
} from '../actionsLibLocally.mts'

const testProjectAndFixtureName = 'test-project-rsa'

const testProjectPath = path.join(
  os.tmpdir(),
  'cedar',
  testProjectAndFixtureName,
  // ":" is problematic with paths
  new Date().toISOString().split(':').join('-'),
)

const core = { setOutput }

const execInProject = createExecWithEnvInCwd(testProjectPath)

setUpRscTestProject(
  testProjectPath,
  testProjectAndFixtureName,
  core,
  execInProject,
)
