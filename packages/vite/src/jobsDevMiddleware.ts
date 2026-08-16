// Runs CedarJS background jobs in-process under Unified Dev (`--ud`).
//
// `cedar-jobs work` (used by classic `cedar dev`) forks one OS process per
// worker and loads both the jobs config and job implementations from
// compiled `api/dist` output. Unified Dev never writes that output — API
// code is served straight from `api/src` via Vite's SSR module runner — so
// that loading strategy can never work here (see
// https://github.com/cedarjs/cedar/issues/2421).
//
// Instead, this module swaps in a Vite-SSR-backed loading strategy (via
// `setJobLoaderOverrides`) and runs the resulting `Worker` instances
// in-process, inside the Unified Dev server itself. `Worker.run()` has no OS
// process affinity — it's a plain async loop — so multiple workers can run
// concurrently in one process via `Promise.all()`.
//
// A nice side effect of loading jobs through the same Vite server that
// already serves `api/src`: job implementation files are re-fetched (and
// therefore hot-reloaded) automatically, since `Executor` calls `loadJob()`
// fresh for every single job execution and `setupHmrHandlers()` in
// `apiDevMiddleware.ts` already invalidates that server's module graph on
// every `api/src` change — no extra watching code needed here. Changes to
// the jobs *topology* (worker counts/queues in `api/src/lib/jobs.ts`) are
// not picked up without a dev server restart; that's a documented
// limitation for now.

import { pathToFileURL } from 'node:url'

import ansis from 'ansis'
import type { ViteDevServer } from 'vite'

import {
  JobNotFoundError,
  JobsLibNotFoundError,
  setJobLoaderOverrides,
} from '@cedarjs/jobs'
import type {
  Adapters,
  BasicLogger,
  JobComputedProperties,
  JobManager,
  QueueNames,
  Worker,
} from '@cedarjs/jobs'
import { getPaths } from '@cedarjs/project-config'

// Mirrors `buildNumWorkers` in `@cedarjs/jobs`'s `cedar-jobs.ts` bin: turns
// a `[{ count: 2, ... }, { count: 1, ... }]` workers config into
// `[[0, 0], [0, 1], [1, 0]]` (worker-config index, worker count id) pairs.
// Not imported directly from that bin file since importing it would also
// run its top-level `main()` call.
function buildNumWorkers(workers: { count?: number }[]): [number, number][] {
  const numWorkers: [number, number][] = []

  workers.forEach((worker, index) => {
    const count = worker.count ?? 1

    for (let id = 0; id < count; id++) {
      numWorkers.push([index, id])
    }
  })

  return numWorkers
}

async function loadJobsManagerViaVite(
  viteServer: ViteDevServer,
): Promise<JobManager<Adapters, QueueNames, BasicLogger>> {
  const jobsConfigPath = getPaths().api.jobsConfig
  if (!jobsConfigPath) {
    throw new JobsLibNotFoundError()
  }

  const mod = await viteServer.ssrLoadModule(pathToFileURL(jobsConfigPath).href)

  if (!mod.jobs) {
    throw new JobsLibNotFoundError()
  }

  return mod.jobs
}

async function loadJobViaVite(
  viteServer: ViteDevServer,
  { name: jobName, path: jobPath }: JobComputedProperties,
) {
  const completeJobPath = `${getPaths().api.jobs}/${jobPath}`

  let mod
  try {
    mod = await viteServer.ssrLoadModule(pathToFileURL(completeJobPath).href)
  } catch {
    throw new JobNotFoundError(jobName)
  }

  if (!mod[jobName]) {
    throw new JobNotFoundError(jobName)
  }

  return mod[jobName]
}

export interface JobsWorkerPool {
  stop: () => Promise<void>
}

/**
 * Starts the configured background jobs workers in-process, loading both the
 * jobs config and job implementations through the given (already-running)
 * api Vite dev server instead of from compiled `api/dist` output.
 *
 * Returns `null` (and logs nothing) when no jobs are configured, mirroring
 * the "just works, opt-in already happened at `cedar setup jobs` time"
 * behaviour of classic dev's nodemon-wrapped worker.
 */
export async function startJobsDevWorkers(
  viteServer: ViteDevServer,
): Promise<JobsWorkerPool | null> {
  setJobLoaderOverrides({
    loadJobsManager: () => loadJobsManagerViaVite(viteServer),
    loadJob: (computedProperties: JobComputedProperties) =>
      loadJobViaVite(viteServer, computedProperties),
  })

  let jobsManager: JobManager<Adapters, QueueNames, BasicLogger>
  try {
    jobsManager = await loadJobsManagerViaVite(viteServer)
  } catch (e) {
    if (e instanceof JobsLibNotFoundError) {
      // Jobs aren't configured for this project - nothing to do.
      setJobLoaderOverrides(undefined)
      return null
    }
    throw e
  }

  const numWorkers = buildNumWorkers(jobsManager.workers)
  const logger = jobsManager.logger ?? console

  if (numWorkers.length === 0) {
    setJobLoaderOverrides(undefined)
    return null
  }

  logger.warn(
    `[CedarJS Jobs] Starting ${numWorkers.length} worker(s) in-process ` +
      '(Unified Dev)...',
  )

  const workers: Worker[] = numWorkers.map(([index, id]) => {
    const workerConfig = jobsManager.workers[index]
    const processName = `ud-jobs.${[workerConfig.queue].flat().join('-')}.${id}`

    return jobsManager.createWorker({
      index,
      clear: false,
      workoff: false,
      processName,
    })
  })

  const runPromise = Promise.all(workers.map((worker) => worker.run()))

  console.log(
    ansis.dim.italic(
      `[CedarJS Jobs] ${workers.length} worker(s) running: ` +
        workers.map((w) => w.processName).join(', '),
    ),
  )

  const stop = async () => {
    // Same graceful-shutdown shape as `cedar-jobs-worker.ts`'s SIGINT
    // handler: let each worker finish its current job (if any), then stop
    // picking up new ones.
    workers.forEach((worker) => {
      worker.forever = false
    })

    await runPromise

    setJobLoaderOverrides(undefined)
  }

  return { stop }
}
