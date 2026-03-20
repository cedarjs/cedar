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
const TEST_PROJECT_PATH = path.join(parentDir, 'kitchen-sink-project-esm')
const execInProject = createExecWithEnvInCwd(TEST_PROJECT_PATH)

core.setOutput('kitchen-sink-project-path', TEST_PROJECT_PATH)

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
    'kitchen-sink-project-esm',
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
    env: { CEDAR_CWD: TEST_PROJECT_PATH },
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

  // .env.user is gitignored in the fixture. Creating it here so that
  // `--load-env-files user` can find it and prisma.config.cjs can read
  // CEDAR_SMOKE_TEST_ENV_VAR
  fs.writeFileSync(
    path.join(TEST_PROJECT_PATH, '.env.user'),
    'CEDAR_SMOKE_TEST_ENV_VAR=test-value\n',
  )

  console.log('Running prisma migrate reset')
  await execInProject(
    'yarn cedar prisma migrate reset --force --load-env-files user',
  )

  console.log('Running prisma db seed')
  await execInProject('yarn cedar prisma db seed')
}

setUpTestProjectEsm({ canary })
