#!/usr/bin/env node

// The process that actually starts an instance of Worker to process jobs.
// Can be run independently with `yarn cedar-jobs-worker` but by default is forked
// by `yarn cedar-jobs` and either monitored, or detached to run independently.
import { hostname } from 'node:os'
import process from 'node:process'

import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

import { PROCESS_TITLE_PREFIX } from '../consts.js'
import type { Worker } from '../core/Worker.js'
import { WorkerConfigIndexNotFoundError } from '../errors.js'
import { loadJobsManager } from '../loaders.js'
import { setupEnv } from '../setupEnv.js'

setupEnv()

const parseArgs = (argv: string[]) => {
  return yargs(hideBin(argv))
    .usage(
      'Starts a single CedarJS Jobs worker to process background jobs\n\n' +
        'Usage: $0 [options]',
    )
    .option('index', {
      type: 'number',
      required: true,
      description:
        'The index of the `workers` array from the exported `jobs` config to ' +
        'use to configure this worker',
    })
    .option('id', {
      type: 'number',
      required: true,
      description:
        'The worker count id to identify this worker. ie: if you had `count: ' +
        '2` in your worker config, you would have two workers with ids 0 and 1',
    })
    .option('workoff', {
      type: 'boolean',
      default: false,
      description: 'Work off all jobs in the queue(s) and exit',
    })
    .option('clear', {
      type: 'boolean',
      default: false,
      description: 'Remove all jobs in all queues and exit',
    })
    .help().argv
}

export const processName = ({
  id,
  queues,
}: {
  id: number
  queues: string | string[]
}) => {
  return `${PROCESS_TITLE_PREFIX}.${[queues].flat().join('-')}.${id}`
}

/**
 * The name a worker locks jobs with (`lockedBy`). A worker takes back any job
 * locked under its own name, so the name has to be unique to this process:
 * the process name alone is the same for the same worker config in every
 * app server, on every host, and two workers sharing it would both run a job,
 * and each one's result would hand the job back to the other to run again
 */
export const lockName = ({
  id,
  queues,
}: {
  id: number
  queues: string | string[]
}) => {
  return `${processName({ id, queues })} host:${hostname()} pid:${process.pid}`
}

const setupSignals = ({ worker }: { worker: Worker }) => {
  // if the parent itself receives a ctrl-c it'll pass that to the workers.
  // workers will exit gracefully by setting `forever` to `false` which will tell
  // it not to pick up a new job when done with the current one
  process.on('SIGINT', () => {
    worker.logger.warn(
      `[${process.title}] SIGINT received at ${new Date().toISOString()}, ` +
        'finishing work...',
    )
    worker.forever = false
  })

  // if the parent itself receives a ctrl-c more than once it'll send SIGTERM
  // instead in which case we exit immediately no matter what state the worker is
  // in
  process.on('SIGTERM', () => {
    worker.logger.warn(
      `[${process.title}] SIGTERM received at ${new Date().toISOString()}, ` +
        'exiting now!',
    )
    process.exit(0)
  })
}

export const getWorker = async ({
  index,
  id,
  clear,
  workoff,
}: {
  index: number
  id: number
  clear: boolean
  workoff: boolean
}) => {
  let manager

  try {
    manager = await loadJobsManager()
  } catch (e) {
    console.error(e)
    process.exit(1)
  }

  const workerConfig = manager.workers[index]
  if (!workerConfig) {
    throw new WorkerConfigIndexNotFoundError(index)
  }

  // A long-running worker syncs the schedules jobs declare before it starts
  // working, so schedules follow the code on every deploy. Every worker does
  // it, which is safe because the sync is idempotent and can't create
  // duplicates. A sync that fails throws, and the worker doesn't start: a
  // worker running without the declared schedules would be a recurring job
  // silently never running
  if (!clear && !workoff) {
    await manager.syncSchedules()
  }

  return manager.createWorker({
    index,
    clear,
    workoff,
    processName: lockName({ id, queues: workerConfig.queue }),
  })
}

const main = async () => {
  const { index, id, clear, workoff } = await parseArgs(process.argv)

  const worker = await getWorker({ index, id, clear, workoff })

  process.title = processName({ id, queues: worker.queues })

  worker.run().then(() => {
    worker.logger.info(`[${process.title}] Worker finished, shutting down.`)
    process.exit(0)
  })

  setupSignals({ worker })
}

// Don't actaully run the worker if we're in a test environment
if (process.env.NODE_ENV !== 'test') {
  main()
}
