import fs from 'node:fs'
import path from 'node:path'

import type { ExecOptions } from '@actions/exec'

import { CEDAR_FRAMEWORK_PATH } from '../actionsLib.mjs'

type Exec = (
  commandLine: string,
  args?: string[],
  options?: ExecOptions,
) => Promise<unknown>

type ExecInProject = (
  commandLine: string,
  options?: Omit<ExecOptions, 'cwd'>,
) => Promise<unknown>

export async function main(
  rscProjectPath: string,
  core: { setOutput: (key: string, value: string) => void },
  exec: Exec,
  execInProject: ExecInProject,
): Promise<void> {
  core.setOutput('rsc-project-path', rscProjectPath)

  console.log('Cedar Framework Path', CEDAR_FRAMEWORK_PATH)
  console.log('rscProjectPath', rscProjectPath)

  await setUpRscProject(rscProjectPath, exec, execInProject)
}

async function setUpRscProject(
  rscProjectPath: string,
  exec: Exec,
  execInProject: ExecInProject,
): Promise<void> {
  const cedarBinPath = path.join(
    CEDAR_FRAMEWORK_PATH,
    'packages/cli/dist/index.js',
  )

  console.log(`Creating project at ${rscProjectPath}`)
  console.log()
  await exec('npx', [
    '-y',
    'create-cedar-app@canary',
    '-y',
    '--no-git',
    '--no-node-check',
    rscProjectPath,
  ])
  await execInProject('yarn install')
  await execInProject('yarn cedar upgrade --yes --tag canary')

  console.log(`Setting up Streaming/SSR in ${rscProjectPath}`)
  const cmdSetupStreamingSSR = `node ${cedarBinPath} experimental setup-streaming-ssr -f`
  await execInProject(cmdSetupStreamingSSR)
  console.log()

  console.log(`Setting up RSC in ${rscProjectPath}`)
  await execInProject(`node ${cedarBinPath} experimental setup-rsc`)
  console.log()

  console.log('Syncing framework')
  // TODO: hard code this to just be `yarn cfw proje...` as soon as cfw is part
  // of a stable Cedar release
  const cfwBin = fs.existsSync(
    path.join(rscProjectPath, 'node_modules/.bin/cfw'),
  )
    ? 'cfw'
    : 'rwfw'
  await execInProject(`yarn ${cfwBin} project:tarsync --verbose`, {
    env: {
      CFW_PATH: CEDAR_FRAMEWORK_PATH,
      RWFW_PATH: CEDAR_FRAMEWORK_PATH,
    },
  })
  console.log()

  console.log(`Building project in ${rscProjectPath}`)
  await execInProject(`node ${cedarBinPath} build -v`)
  console.log()
}
