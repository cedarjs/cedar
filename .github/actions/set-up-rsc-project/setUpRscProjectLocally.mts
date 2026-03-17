import os from 'node:os'
import path from 'node:path'

import type { ExecOptions } from '@actions/exec'

import { createExecWithEnvInCwd, setOutput } from '../actionsLibLocally.mts'

import { main } from './setUpRscProject.mts'

const rscProjectPath = path.join(
  os.tmpdir(),
  'redwood-rsc-project',
  // ":" is problematic with paths
  new Date().toISOString().split(':').join('-'),
)

// Mock for @actions/core
const core = { setOutput }

const execInProject = createExecWithEnvInCwd(rscProjectPath)

const execInRootWithCwd = createExecWithEnvInCwd('/')

/**
 * Adapter to match the three-argument Exec signature expected by main().
 * The `args` array is joined into the command string because
 * createExecWithEnvInCwd passes the whole command to a shell anyway.
 */
function execInRoot(
  commandLine: string,
  args?: string[],
  options?: Omit<ExecOptions, 'cwd'>,
) {
  const fullCommand =
    args && args.length > 0 ? `${commandLine} ${args.join(' ')}` : commandLine

  return execInRootWithCwd(fullCommand, options)
}

main(rscProjectPath, core, execInRoot, execInProject)
