// @ts-check

import fs from 'node:fs'
import path from 'node:path'

import core from '@actions/core'

import {
  createExecWithEnvInCwd,
  execInFramework,
  CEDAR_FRAMEWORK_PATH,
} from '../actionsLib.mjs'

const parentDir = path.dirname(process.cwd())
const TEST_PROJECT_PATH = path.join(parentDir, 'esm-test-project')
const execInProject = createExecWithEnvInCwd(TEST_PROJECT_PATH)

core.setOutput('test-project-path', TEST_PROJECT_PATH)

const canary = core.getInput('canary') === 'true'
console.log({ canary })

console.log()

/**
 * @param {{canary: boolean}} options
 * @returns {Promise<void>}
 */
async function setUpTestProjectEsm({ canary }) {
  const TEST_PROJECT_FIXTURE_PATH = path.join(
    CEDAR_FRAMEWORK_PATH,
    '__fixtures__',
    'esm-test-project',
  )

  console.log(`Creating project at ${TEST_PROJECT_PATH}`)
  console.log()

  await fs.promises.cp(TEST_PROJECT_FIXTURE_PATH, TEST_PROJECT_PATH, {
    recursive: true,
  })

  if (canary) {
    console.log(`Upgrading project to canary`)

    await execInProject('yarn cedar upgrade -t canary', {
      input: Buffer.from('Y'),
    })

    console.log()
  }

  await execInFramework('yarn project:tarsync --verbose', {
    env: { RWJS_CWD: TEST_PROJECT_PATH },
  })

  console.log('Generating dbAuth secret')
  const { stdout } = await execInProject('yarn cedar g secret --raw', {
    silent: true,
  })
  fs.appendFileSync(
    path.join(TEST_PROJECT_PATH, '.env'),
    `SESSION_SECRET='${stdout}'`,
  )
  console.log()

  console.log('Running prisma migrate reset')
  await execInProject('yarn cedar prisma migrate reset --force')
}

setUpTestProjectEsm({ canary })
