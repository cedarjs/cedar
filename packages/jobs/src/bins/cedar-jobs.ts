#!/usr/bin/env node

// Coordinates the worker processes: running attached in [work] mode or
// detaching in [start] mode.

import type { ChildProcess } from 'node:child_process'
import { fork, exec } from 'node:child_process'
import console from 'node:console'
import path from 'node:path'
import process from 'node:process'
import { setTimeout } from 'node:timers'

import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

import { DEFAULT_LOGGER, PROCESS_TITLE_PREFIX } from '../consts.js'
import type { JobManager } from '../core/JobManager.js'
import { scheduleName } from '../core/JobManager.js'
import { ScheduleNotFoundError } from '../errors.js'
import { loadAllJobs, loadJobsManager } from '../loaders.js'
import { setupEnv } from '../setupEnv.js'
import type {
  Adapters,
  BasicLogger,
  Job,
  WorkerConfig,
  QueueNames,
} from '../types.js'

export type NumWorkersConfig = [number, number][]

setupEnv()

process.title = 'cedar-jobs'

const WORKER_PATH = path.join(import.meta.dirname, 'cedar-jobs-worker.js')

export const parseArgs = (argv: string[]) => {
  const commandString = hideBin(argv)

  if (commandString.length === 1 && commandString[0] === 'jobs') {
    commandString.shift()
  }

  const parsed: Record<string, any> = yargs(commandString)
    .usage(
      'Starts the CedarJS Jobs runner to process background jobs\n\n' +
        'Usage: cedar jobs <command> [options]',
    )
    .command('work', 'Start a worker and process jobs')
    .command('workoff', 'Start a worker and exit after all jobs processed')
    .command('start', 'Start workers in daemon mode')
    .command('stop', 'Stop any daemonized job workers')
    .command('restart', 'Stop and start any daemonized job workers')
    .command('clear', 'Clear the job queue')
    .command(
      'pause <schedule>',
      "Pause a job's declared schedule, given as JobName or JobName:key",
    )
    .command(
      'resume <schedule>',
      'Resume a paused declared schedule, given as JobName or JobName:key',
    )
    .command('schedules', 'List the declared schedules')
    .demandCommand(1, 'You must specify a mode to start in')
    .example(
      'cedar jobs work',
      'Start the job workers using the job config and work on jobs until ' +
        'manually stopped',
    )
    .example(
      'cedar jobs start',
      'Start the job workers using the job config and detach, running in ' +
        'daemon mode',
    )
    .example(
      'cedar jobs pause ReportJob:nightly',
      'Stop the `nightly` schedule of ReportJob from running until it is ' +
        'resumed with `cedar jobs resume ReportJob:nightly`',
    )
    .help()
    .parse(commandString, (_err: any, _argv: any, output: any) => {
      if (output) {
        const newOutput = output.replaceAll('cedar-jobs.js', 'cedar jobs')
        console.log(newOutput)
      }
    })

  return {
    command: parsed._[0],
    schedule:
      typeof parsed.schedule === 'string' || typeof parsed.schedule === 'number'
        ? String(parsed.schedule)
        : undefined,
  }
}

/**
 * Splits a schedule given on the command line, `JobName` or `JobName:key`,
 * into the job's name and the schedule's key. Job names are identifiers, so
 * everything after the first `:` is the key
 */
export const parseScheduleArg = (value: string) => {
  const separator = value.indexOf(':')

  if (separator === -1) {
    return { jobName: value, key: undefined }
  }

  return {
    jobName: value.slice(0, separator),
    key: value.slice(separator + 1) || undefined,
  }
}

type AnyJobManager = JobManager<Adapters, QueueNames, BasicLogger>

/**
 * `cedar jobs pause`, `resume` and `schedules`. Returns what to print
 */
export const runScheduleCommand = async ({
  command,
  schedule,
  manager,
  loadJobs = loadAllJobs,
}: {
  command: 'pause' | 'resume' | 'schedules'
  schedule?: string | undefined
  manager: AnyJobManager
  loadJobs?: () => Promise<Job<QueueNames, unknown[]>[]>
}): Promise<string> => {
  if (command === 'schedules') {
    const schedules = await manager.listSchedules()

    if (schedules.length === 0) {
      return 'No declared schedules are stored'
    }

    const rows = schedules.map((stored) => [
      scheduleName(stored.key),
      stored.cron ?? '',
      stored.pausedAt
        ? `paused since ${stored.pausedAt.toISOString()}`
        : stored.running
          ? 'running'
          : `next run ${stored.runAt?.toISOString() ?? '-'}`,
    ])
    const widths = [0, 1].map((column) =>
      Math.max(...rows.map((row) => row[column].length)),
    )

    return rows
      .map((row) =>
        [row[0].padEnd(widths[0]), row[1].padEnd(widths[1]), row[2]].join('  '),
      )
      .join('\n')
  }

  if (!schedule) {
    throw new ScheduleNotFoundError(
      `Say which schedule to ${command}: JobName or JobName:key`,
    )
  }

  const { jobName, key } = parseScheduleArg(schedule)
  const jobs = await loadJobs()
  const job = jobs.find((candidate) => candidate.name === jobName)

  if (!job) {
    const withSchedules = jobs
      .filter((candidate) => candidate.schedules?.length)
      .map((candidate) => candidate.name)

    throw new ScheduleNotFoundError(
      `There is no job named ${jobName}. Jobs with declared schedules: ` +
        (withSchedules.join(', ') || 'none'),
    )
  }

  if (command === 'pause') {
    const result = await manager.pauseSchedule(job, key)
    const name = scheduleName(result.key)

    return result.alreadyPaused
      ? `${name} was already paused (since ${result.pausedAt.toISOString()})`
      : `Paused ${name}. It doesn't run until you resume it with ` +
          `\`yarn cedar jobs resume ${name}\``
  }

  const result = await manager.resumeSchedule(job, key)
  const name = scheduleName(result.key)

  return result.wasPaused
    ? `Resumed ${name}. Its next run is at ${result.runAt?.toISOString()}`
    : `${name} isn't paused. Its next run is at ` +
        `${result.runAt?.toISOString() ?? '-'}`
}

// Builds up an array of arrays, with the worker config index and id based on
// how many workers should use this config. For the following config:
//
// {
//   workers: [
//     {
//       adapter: 'prisma',
//       count: 2,
//       queue: 'default',
//     },
//     {
//       adapter: 'prisma',
//       count: 1,
//       queue: 'email',
//     },
//   ]
// }
//
// The output would be:
//
// [
//   [0, 0], // first array element, first worker
//   [0, 1], // first array element, second worker
//   [1, 0], // second array element, first worker
// ]
export const buildNumWorkers = (config: any) => {
  const workers: NumWorkersConfig = []

  config.map((worker: any, index: number) => {
    for (let id = 0; id < worker.count; id++) {
      workers.push([index, id])
    }
  })

  return workers
}

export const startWorkers = ({
  numWorkers,
  detach = false,
  workoff = false,
  logger,
}: {
  numWorkers: NumWorkersConfig
  detach?: boolean
  workoff?: boolean
  logger: BasicLogger
}) => {
  logger.warn(`Starting ${numWorkers.length} worker(s)...`)

  return numWorkers.map(([index, id]) => {
    // list of args to send to the forked worker script
    const workerArgs = ['--index', index.toString(), '--id', id.toString()]

    if (workoff) {
      workerArgs.push('--workoff')
    }

    // fork the worker process
    const worker = fork(WORKER_PATH, workerArgs, {
      detached: detach,
      stdio: detach ? 'ignore' : 'inherit',
      env: process.env,
    })

    if (detach) {
      worker.unref()
    } else {
      // children stay attached so watch for their exit before exiting parent
      worker.on('exit', (_code) => {})
    }

    return worker
  })
}

// TODO add support for stopping with SIGTERM or SIGKILL?
export const stopWorkers = async ({
  numWorkers,
  signal = 'SIGINT',
  logger,
}: {
  numWorkers: NumWorkersConfig
  signal: string
  logger: BasicLogger
}) => {
  logger.warn(
    `Stopping ${numWorkers.length} worker(s) gracefully (${signal})...`,
  )

  const processIds = await findWorkerProcesses()

  if (processIds.length === 0) {
    logger.warn(`No running workers found.`)
    return
  }

  for (const processId of processIds) {
    logger.info(`Stopping process id ${processId}...`)
    process.kill(processId, signal)

    // wait for the process to actually exit before going to next iteration
    while ((await findWorkerProcesses(processId)).length) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

export const clearQueue = ({ logger }: { logger: BasicLogger }) => {
  logger.warn(`Starting worker to clear job queue...`)
  fork(WORKER_PATH, ['--clear', '--index', '0', '--id', '0'])
}

const signalSetup = ({
  workers,
  logger,
}: {
  workers: ChildProcess[]
  logger: BasicLogger
}) => {
  // Keep track of how many times the user has pressed ctrl-c
  let sigtermCount = 0

  // If the parent receives a ctrl-c, tell each worker to gracefully exit.
  // If the parent receives a second ctrl-c, exit immediately.
  process.on('SIGINT', () => {
    sigtermCount++
    let message =
      'SIGINT received: shutting down workers gracefully (press Ctrl-C again ' +
      'to exit immediately)...'

    if (sigtermCount > 1) {
      message = 'SIGINT received again, exiting immediately...'
    }

    logger.info(message)

    workers.forEach((worker) => {
      if (sigtermCount > 1) {
        worker.kill('SIGTERM')
      } else {
        worker.kill('SIGINT')
      }
    })
  })
}

// Find the process id of a worker by its title
const findWorkerProcesses = async (id?: number): Promise<number[]> => {
  return new Promise(function (resolve, reject) {
    const platform = process.platform
    const cmd =
      platform === 'win32'
        ? 'tasklist'
        : platform === 'darwin'
          ? 'ps -ax | grep ' + PROCESS_TITLE_PREFIX
          : platform === 'linux'
            ? 'ps -A'
            : ''
    if (cmd === '') {
      resolve([])
    }
    exec(cmd, function (err, stdout) {
      if (err) {
        reject(err)
      }

      const list = stdout.trim().split('\n')
      const matches = list.filter((line) => {
        if (platform == 'darwin' || platform == 'linux') {
          return !line.match('grep')
        }
        return true
      })

      // no job workers running
      if (matches.length === 0) {
        resolve([])
      }

      const pids = matches.map((line) => parseInt(line.split(' ')[0]))

      if (id) {
        // will return the single job worker process ID if still running
        resolve(pids.filter((pid) => pid === id))
      } else {
        // return all job worker process IDs
        resolve(pids)
      }
    })
  })
}

const main = async () => {
  const { command, schedule } = parseArgs(process.argv)
  let jobsConfig

  try {
    jobsConfig = await loadJobsManager()
  } catch (e) {
    console.error(e)
    process.exit(1)
  }

  if (command === 'pause' || command === 'resume' || command === 'schedules') {
    try {
      console.log(
        await runScheduleCommand({ command, schedule, manager: jobsConfig }),
      )
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }

    return process.exit(0)
  }

  const workerConfig: WorkerConfig<Adapters, QueueNames>[] = jobsConfig.workers
  const numWorkers = buildNumWorkers(workerConfig)
  const logger = jobsConfig.logger ?? DEFAULT_LOGGER

  logger.warn(`Starting CedarJS Jobs Runner at ${new Date().toISOString()}...`)

  switch (command) {
    case 'start':
      startWorkers({
        numWorkers,
        detach: true,
        logger,
      })
      return process.exit(0)
    case 'stop':
      return await stopWorkers({
        numWorkers,
        signal: 'SIGINT',
        logger,
      })
    case 'restart':
      await stopWorkers({ numWorkers, signal: 'SIGINT', logger })
      startWorkers({
        numWorkers,
        detach: true,
        logger,
      })
      return process.exit(0)
    case 'work':
      return signalSetup({
        workers: startWorkers({
          numWorkers,
          logger,
        }),
        logger,
      })
    case 'workoff':
      return signalSetup({
        workers: startWorkers({
          numWorkers,
          workoff: true,
          logger,
        }),
        logger,
      })
    case 'clear':
      return clearQueue({ logger })
  }
}

// Don't actaully run the worker if we're in a test environment
if (process.env.NODE_ENV !== 'test') {
  main()
}
