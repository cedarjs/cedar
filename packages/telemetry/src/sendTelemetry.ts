import fs from 'node:fs'
import os from 'os'
import path from 'path'

import { fetch } from '@whatwg-node/fetch'
import ci from 'ci-info'
import envinfo from 'envinfo'
import { v4 as uuidv4 } from 'uuid'
import yargsParser from 'yargs/yargs'

import { getRawConfig, getPaths } from '@cedarjs/project-config'
import { RWProject } from '@cedarjs/structure/dist/model/RWProject'

import { redactErrorMessage } from './redact.js'

interface Args {
  cedarVersion?: string
  command?: string
}

/** Gets diagnostic info and sanitizes by removing references to paths */
const getInfo = async (presets: Args = {}) => {
  const info = JSON.parse(
    await envinfo.run(
      {
        System: ['OS', 'Shell'],
        Binaries: ['Node', 'Yarn', 'npm'],
        npmPackages: '@cedarjs/*',
        IDEs: ['VSCode'],
      },
      { json: true },
    ),
  )

  // get shell name instead of path
  const shell = info.System?.Shell // Windows doesn't always provide shell info, I guess
  if (shell?.path?.match('/')) {
    info.System.Shell.name = info.System.Shell.path.split('/').pop()
  } else if (shell?.path.match('\\')) {
    info.System.Shell.name = info.System.Shell.path.split('\\').pop()
  }

  const cpuCount = os.availableParallelism()
  const memoryGb = Math.round(os.totalmem() / 1073741824)

  // Returns a list of all enabled experiments
  // This detects all top level [experimental.X] and returns all X's, ignoring all Y's for any [experimental.X.Y]
  const experiments = Object.keys(getRawConfig()['experimental'] || {})

  return {
    os: info.System?.OS?.split(' ')[0],
    osVersion: info.System?.OS?.split(' ')[1],
    shell: info.System?.Shell?.name,
    nodeVersion: info.Binaries?.Node?.version,
    yarnVersion: info.Binaries?.Yarn?.version,
    npmVersion: info.Binaries?.npm?.version,
    vsCodeVersion: info.IDEs?.VSCode?.version,
    cedarVersion:
      presets.cedarVersion || info.npmPackages?.['@cedarjs/core']?.installed,
    system: `${cpuCount}.${memoryGb}`,
    experiments,
  }
}

const LONG_OPTION_NAME = /^--[a-zA-Z][\w-]*/
// A short option can have its value attached, e.g. `-dweb/dist`, so only the
// first letter is the option's name
const SHORT_OPTION_NAME = /^-[a-zA-Z]/
const COMMAND_NAME = /^[a-z][\w:-]*$/i

/**
 * Turns `process.argv` into the `command` string sent with telemetry, for
 * events sent before the CLI has described the running command (see
 * `commandForTelemetry`).
 *
 * Only the command and the names of the options are kept, e.g.
 * `generate --force --typescript`. Option values, positional arguments and
 * everything after `--` can contain names, paths, hosts and other values
 * that identify a user or their project, so they are left out.
 *
 * The command is the first argument after the script path. It is only kept
 * if it looks like a command name, like `build` or `data-migrate`.
 *
 * `exec` passes its options on to the user's script, so for `exec` only the
 * command is kept.
 */
export const sanitizeArgv = (argv: string[]) => {
  const args = argv.slice(2)
  const passthroughIndex = args.indexOf('--')
  const ownArgs =
    passthroughIndex === -1 ? args : args.slice(0, passthroughIndex)

  if (ownArgs[0] === 'exec') {
    return 'exec'
  }

  return ownArgs
    .flatMap((arg, index) => {
      const optionName =
        arg.match(LONG_OPTION_NAME)?.[0] ?? arg.match(SHORT_OPTION_NAME)?.[0]

      if (optionName) {
        return [optionName]
      }

      return index === 0 && COMMAND_NAME.test(arg) ? [arg] : []
    })
    .join(' ')
}

const buildPayload = async () => {
  let payload: Record<string, unknown> = {}

  const processArgv = [...process.argv]

  // On windows process.argv may not return an array of strings.
  // It will look something like [a,b,c] rather than ["a","b","c"] so we must stringify them before parsing as JSON
  // "os.type()" returns 'Windows_NT' on Windows. See https://nodejs.org/docs/latest-v12.x/api/os.html#os_os_type.
  if (os.type() === 'Windows_NT') {
    const argvIndex = processArgv.findIndex((arg) => arg === '--argv') + 1
    let argvFormatted = argvIndex !== 0 ? processArgv[argvIndex] : null
    if (argvFormatted) {
      argvFormatted =
        '[' +
        argvFormatted
          .substring(1, argvFormatted.length - 1)
          .split(',')
          .map((arg) => {
            return arg.startsWith('"') || arg.startsWith("'") ? arg : `"${arg}"`
          })
          .join(',') +
        ']'
      processArgv[argvIndex] = argvFormatted
    }
  }

  const rawArgv = yargsParser(processArgv.slice(2)).parseSync()

  const argvFlag = typeof rawArgv.argv === 'string' ? rawArgv.argv : undefined
  const typeFlag = typeof rawArgv.type === 'string' ? rawArgv.type : undefined
  const durationFlag =
    typeof rawArgv.duration === 'string' ? rawArgv.duration : undefined
  const rwVersionFlag =
    typeof rawArgv.rwVersion === 'string' ? rawArgv.rwVersion : undefined
  const errorFlag =
    typeof rawArgv.error === 'string' ? rawArgv.error : undefined

  const commandFlag =
    typeof rawArgv.command === 'string' ? rawArgv.command : undefined

  const command = commandFlag
    ? String(JSON.parse(commandFlag))
    : argvFlag
      ? sanitizeArgv(JSON.parse(argvFlag))
      : ''
  payload = {
    type: typeFlag || 'command',
    command,
    duration: durationFlag ? parseInt(durationFlag) : null,
    uid: uniqueId(),
    ci: ci.isCI,
    cedarCi: !!process.env.CEDAR_CI,
    NODE_ENV: process.env.NODE_ENV || null,
    ...(await getInfo({ cedarVersion: rwVersionFlag, command })),
  }

  if (errorFlag) {
    payload.type = 'error'
    payload.error = redactErrorMessage(errorFlag)
  }

  const project = new RWProject()
  const routes = project.getRouter().routes
  const prerenderedRoutes = routes.filter((route) => route.hasPrerender)

  // add in app stats
  payload = {
    ...payload,
    complexity:
      `${routes.length}.${prerenderedRoutes.length}.` +
      `${project.services.length}.${project.cells.length}.` +
      `${project.pages.length}`,
    sides: project.sides.join(','),
  }

  return payload
}

// returns the UUID for this device. caches the UUID for 24 hours
function uniqueId() {
  const telemetryCachePath = path.join(
    getPaths().generated.base,
    'telemetry.txt',
  )
  const now = Date.now()
  const expires = now - 24 * 60 * 60 * 1000 // one day
  let uuid

  if (
    !fs.existsSync(telemetryCachePath) ||
    fs.statSync(telemetryCachePath).mtimeMs < expires
  ) {
    uuid = uuidv4()
    try {
      // Create the generated directory if it does not exist
      if (!fs.existsSync(path.dirname(telemetryCachePath))) {
        fs.mkdirSync(path.dirname(telemetryCachePath), { recursive: true })
      }
      fs.writeFileSync(telemetryCachePath, uuid)
    } catch {
      console.error('\nCould not create telemetry.txt file\n')
    }
  } else {
    uuid = fs.readFileSync(telemetryCachePath).toString()
  }

  return uuid
}

// actually call the API with telemetry data
export const sendTelemetry = async () => {
  const telemetryUrl =
    process.env.CEDAR_REDIRECT_TELEMETRY ||
    process.env.REDWOOD_REDIRECT_TELEMETRY ||
    'https://telemetry.redwoodjs.com/api/v1/telemetry'
  const verboseTelemetry =
    process.env.CEDAR_VERBOSE_TELEMETRY || process.env.REDWOOD_VERBOSE_TELEMETRY

  try {
    const payload = await buildPayload()

    if (verboseTelemetry) {
      console.info('Cedar Telemetry Payload', payload)
    }

    const response = await fetch(telemetryUrl, {
      method: 'post',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    })

    if (verboseTelemetry) {
      console.info('Cedar Telemetry Response:', response)
    }

    // Normally we would report on any non-error response here (like a 500)
    // but since the process is spawned and stdout/stderr is ignored, it can
    // never be seen by the user, so ignore.
    if (verboseTelemetry && response.status !== 200) {
      console.error('Error from telemetry insert:', await response.text())
    }
  } catch (e) {
    // service interruption: network down or telemetry API not responding
    // don't let telemetry errors bubble up to user, just do nothing.
    if (verboseTelemetry) {
      console.error('Uncaught error in telemetry:', e)
    }
  }
}
