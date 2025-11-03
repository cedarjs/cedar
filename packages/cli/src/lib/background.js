import { spawn } from 'child_process'
import os from 'os'
import path from 'path'

import fs from 'fs-extra'

import { getPaths } from '@cedarjs/project-config'

/**
 * Spawn a background process with the stdout/stderr redirected to log files within the `.redwood` directory.
 * Stdin will not be available to the process as it will be set to the 'ignore' value.
 *
 * @param {string} name A name for this background process, will be used to name the log files
 * @param {string} cmd Command to pass to the `spawn` function
 * @param {string[]} args Arguements to pass to the `spawn` function
 */
export function spawnBackgroundProcess(name, cmd, args) {
  const logDirectory = path.join(getPaths().generated.base, 'logs')
  fs.ensureDirSync(logDirectory)

  const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase()

  const logHeader = [
    `Starting log:`,
    ` - Time: ${new Date().toISOString()}`,
    ` - Name: ${name} (${safeName})`,
    ` - Command: ${cmd}`,
    ` - Arguments: ${args.join(' ')}`,
    '',
    '',
  ].join('\n')

  const stdout = fs.openSync(
    path.join(logDirectory, `${safeName}.out.log`),
    'w',
  )
  fs.writeSync(stdout, logHeader)

  const stderr = fs.openSync(
    path.join(logDirectory, `${safeName}.err.log`),
    'w',
  )
  fs.writeSync(stderr, logHeader)

  // We must account for some platform specific behaviour
  if (os.type() === 'Windows_NT') {
    const spawnOptions = {
      // The following options run the process in the background without a
      // console window, even though they don't look like they would.
      // See https://github.com/nodejs/node/issues/21825#issuecomment-503766781
      // for information.
      detached: false,
      windowsHide: false,
      shell: true,
      stdio: ['ignore', stdout, stderr],
    }

    // Spawn and detach the process
    //
    // The best way to use `spawn` is to pass the process args as a separate
    // argument, but when the spawn options include `shell: true`, like they do
    // here, that causes Node.js to print a DEP0190 warning. To get around this
    // we instead concatenate the command and arguments into a single string.
    // It's safe to do that here since the arguments aren't user-provided.
    //
    // https://nodejs.org/api/deprecations.html#DEP0190
    const child = spawn(cmd + ' ' + args.join(' '), spawnOptions)
    child.unref()
  } else {
    const spawnOptions = {
      detached: true,
      stdio: ['ignore', stdout, stderr],
    }

    // Spawn and detach the process
    //
    // For Linux and MacOS we don't need `shell: true`, so here we can use the
    // `cmd` and `args` arguments separately.
    const child = spawn(cmd, args, spawnOptions)
    child.unref()
  }
}
