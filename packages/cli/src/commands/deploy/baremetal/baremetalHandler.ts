import fs from 'node:fs'
import path from 'node:path'

import boxen from 'boxen'
import execa from 'execa'
import { Listr } from 'listr2'
import * as toml from 'smol-toml'
import { env as envInterpolation } from 'string-env-interpolation'
import { titleCase } from 'title-case'

import { colors as c } from '@cedarjs/cli-helpers/colors'
import { formatCedarCommand } from '@cedarjs/cli-helpers/packageManager/display'
import { getPackageManager } from '@cedarjs/project-config/packageManager'

import { getConfig, getPaths } from '../../../lib/index.js'

import { MONITOR_ADAPTERS, MONITORS, isMonitor } from './monitors.js'
import type { Monitor, MonitorAdapter, MonitorCommand } from './monitors.js'
import type { SshExecutor } from './SshExecutor.js'

const CONFIG_FILENAME = 'deploy.toml'
const DOCS_URL = 'https://cedarjs.com/docs/deploy/baremetal'
const SYMLINK_FLAGS = '-nsf'
const CURRENT_RELEASE_SYMLINK_NAME = 'current'
const LIFECYCLE_HOOKS = ['before', 'after'] as const
// Path of the health check endpoint that Cedar's GraphQL server serves
const DEFAULT_HEALTH_CHECK_PATH = '/graphql/health'
// Time between two attempts of the post-restart health check
const HEALTH_CHECK_INTERVAL_MS = 2000
// Longest a single health check request waits for a response
const HEALTH_CHECK_REQUEST_TIMEOUT_SECONDS = 5
// Web build output directories, relative to a release. SPA and prerendered
// builds write to the first, streaming SSR and RSC builds to the second.
const WEB_DIST_DIRS = ['web/dist', 'web/dist/browser']
const BUILD_MANIFEST_FILENAME = 'client-build-manifest.json'
// Number of files passed to a single `ln` command when keeping web assets
const LINK_BATCH_SIZE = 100

/**
 * Matches the release directory names created by `cedar deploy baremetal`.
 * The default `releaseDir` is a UTC timestamp formatted as `YYYYMMDDHHmmss`
 * (see the `releaseDir` option in `../baremetal.ts`). Only directories matching
 * this pattern are removed when cleaning up old releases.
 */
export const RELEASE_DIR_PATTERN = '^[0-9]{14}$'
const releaseDirRegExp = new RegExp(RELEASE_DIR_PATTERN)

const DEFAULT_MONITOR: Monitor = 'pm2'

export const DEFAULT_SERVER_CONFIG = {
  port: 22,
  branch: 'main',
  packageManagerCommand: getPackageManager(),
  monitor: DEFAULT_MONITOR,
  sides: ['api', 'web'],
  keepReleases: 5,
  freeSpaceRequired: 2048,
  healthCheckTimeout: 30,
}

// force all paths to have forward slashes so that you can deploy to *nix
// systems from a Windows system
const pathJoin = path.posix.join

// Wraps a value in single quotes for use as a shell argument
const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

// Shape of a server configuration entry from deploy.toml
export interface ServerConfig {
  host: string
  port: number
  branch: string
  username: string
  password?: string
  privateKey?: string
  privateKeyPath?: string
  passphrase?: string
  agentForward?: boolean
  path: string
  repo: string
  packageManagerCommand: string
  /** Process monitor whose commands the deploy runs, see `MONITORS` */
  monitor: Monitor
  /**
   * Command the monitor is invoked with. Defaults to the monitor's own command
   * (`pm2`, `systemctl --user` or `sudo systemctl`) and can be prefixed or
   * replaced, for example `doppler run -- pm2`.
   */
  monitorCommand: string
  sides: string[]
  processNames?: string[]
  keepReleases: number
  freeSpaceRequired: number | string
  migrate?: boolean
  /**
   * URL requested on the server after its processes have been restarted.
   * Defaults to the api side's `/graphql/health` endpoint on localhost.
   * `false` disables the health check.
   */
  healthCheckUrl?: string | false
  /** Seconds to keep retrying the health check before failing the deploy */
  healthCheckTimeout: number | string
}

// Shape of the yargs argv for baremetal deploy commands
export interface BaremetalYargs {
  environment: string
  releaseDir: string
  branch?: string
  firstRun?: boolean
  maintenance?: string
  rollback?: number
  df?: boolean
  update?: boolean
  install?: boolean
  migrate?: boolean
  build?: boolean
  restart?: boolean
  cleanup?: boolean
  keepAssets?: boolean
  gitCheck?: boolean
  verbose?: boolean
}

// Lifecycle hooks structure: { before: { [task]: string[] }, after: { [task]: string[] } }
export type LifecycleHooks = {
  before: Record<string, string[]>
  after: Record<string, string[]>
}

// Command config passed to lifecycle helpers
interface CommandConfig {
  yargs: BaremetalYargs
  ssh: SshExecutor
  serverConfig: ServerConfig
  serverLifecycle: LifecycleHooks
  cmdPath: string
}

export interface ListrTaskObject {
  title: string
  task: (...args: unknown[]) => unknown
  skip?: () => boolean
}

export const throwMissingConfig = (name: string) => {
  throw new Error(
    `"${name}" config option not set. See https://cedarjs.com/docs/deployment/baremetal#deploytoml`,
  )
}

export const verifyConfig = (
  config: Record<string, unknown>,
  yargs: BaremetalYargs,
) => {
  if (!yargs.environment) {
    throw new Error(
      `Must specify an environment to deploy to, ex: \`${formatCedarCommand(['deploy', 'baremetal', 'production'])}\``,
    )
  }

  if (!config[yargs.environment]) {
    throw new Error(`No servers found for environment "${yargs.environment}"`)
  }

  return true
}

const isHttpUrl = (value: unknown) => {
  if (typeof value !== 'string') {
    return false
  }

  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export const verifyServerConfig = (config: ServerConfig) => {
  if (!config.host) {
    throwMissingConfig('host')
  }

  if (!config.path) {
    throwMissingConfig('path')
  }

  if (!config.repo) {
    throwMissingConfig('repo')
  }

  if (!/^\d+$/.test(String(config.freeSpaceRequired))) {
    throw new Error('"freeSpaceRequired" must be an integer >= 0')
  }

  if (
    config.healthCheckUrl !== undefined &&
    config.healthCheckUrl !== false &&
    !isHttpUrl(config.healthCheckUrl)
  ) {
    throw new Error('"healthCheckUrl" must be an http(s) URL or `false`')
  }

  if (!/^\d+$/.test(String(config.healthCheckTimeout))) {
    throw new Error('"healthCheckTimeout" must be an integer >= 0')
  }

  if (!isMonitor(config.monitor)) {
    throw new Error(
      `"monitor" must be one of ${MONITORS.map((monitor) => `"${monitor}"`).join(', ')}`,
    )
  }

  return true
}

const symlinkCurrentCommand = async (
  dir: string,
  ssh: SshExecutor,
  deployPath: string,
) => {
  return await ssh.exec(deployPath, 'ln', [
    SYMLINK_FLAGS,
    dir,
    CURRENT_RELEASE_SYMLINK_NAME,
  ])
}

const monitorAdapter = (serverConfig: ServerConfig): MonitorAdapter =>
  MONITOR_ADAPTERS[serverConfig.monitor]

// Runs one of the monitor adapter's commands on the server
const runMonitorCommand = async (
  command: MonitorCommand,
  ssh: SshExecutor,
  serverConfig: ServerConfig,
) => {
  return await ssh.exec(
    serverConfig.path,
    serverConfig.monitorCommand,
    command.args,
  )
}

// Listr task that runs one of the monitor adapter's commands
const monitorTask = (
  command: MonitorCommand,
  ssh: SshExecutor,
  serverConfig: ServerConfig,
  skip?: () => boolean,
): ListrTaskObject => {
  return {
    title: command.title,
    task: async () => {
      await runMonitorCommand(command, ssh, serverConfig)
    },
    ...(skip ? { skip } : {}),
  }
}

/**
 * The URL the post-restart health check requests, or `undefined` when there
 * is nothing to check on this server. Without an explicit `healthCheckUrl`
 * only servers that host the api side are checked, at the `/graphql/health`
 * endpoint Cedar's GraphQL server serves on the `[api].port` from cedar.toml.
 * `cedar serve` and `cedar serve api` both listen on that port.
 */
export const healthCheckUrl = (serverConfig: ServerConfig) => {
  if (serverConfig.healthCheckUrl === false) {
    return undefined
  }

  if (serverConfig.healthCheckUrl) {
    return serverConfig.healthCheckUrl
  }

  if (!serverConfig.sides.includes('api')) {
    return undefined
  }

  return `http://localhost:${getConfig().api.port}${DEFAULT_HEALTH_CHECK_PATH}`
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Requests `url` on the server until it responds with a 2xx status. Gives up
 * and throws once `timeoutSeconds` have passed, with `nextSteps` appended to
 * the error message so the message says what to do about the failure.
 * `onFailedAttempt` is called with the reason each time an attempt fails.
 */
export const waitForHealthCheck = async ({
  url,
  timeoutSeconds,
  ssh,
  serverConfig,
  nextSteps,
  onFailedAttempt,
}: {
  url: string
  timeoutSeconds: number
  ssh: SshExecutor
  serverConfig: ServerConfig
  nextSteps: string[]
  onFailedAttempt?: (reason: string) => void
}) => {
  const deadline = Date.now() + timeoutSeconds * 1000
  let lastFailure = ''
  let keepTrying = true

  // Each attempt is one `curl` on the server. `--fail` makes curl exit
  // non-zero for HTTP error statuses, so `ssh.exec` throws both when nothing
  // is listening and when the process is up but reports itself unhealthy.
  // `--location` follows redirects, so a URL that redirects (for example from
  // http to https) is judged by the response of the final destination.
  while (keepTrying) {
    try {
      await ssh.exec(serverConfig.path, 'curl', [
        '--fail',
        '--location',
        '--silent',
        '--show-error',
        '--output',
        '/dev/null',
        '--max-time',
        String(HEALTH_CHECK_REQUEST_TIMEOUT_SECONDS),
        shellQuote(url),
      ])

      return
    } catch (e) {
      lastFailure = e instanceof Error ? e.message : String(e)
      onFailedAttempt?.(lastFailure)
    }

    // Another attempt only makes sense if it fits before the deadline
    keepTrying = Date.now() + HEALTH_CHECK_INTERVAL_MS <= deadline

    if (keepTrying) {
      await sleep(HEALTH_CHECK_INTERVAL_MS)
    }
  }

  throw new Error(
    [
      `Health check failed: ${url} did not respond successfully within ` +
        `${timeoutSeconds} seconds of restarting the ` +
        `${serverConfig.processNames?.join(', ')} process(es).`,
      `Last attempt: ${lastFailure}`,
      '',
      ...nextSteps,
      'If your app serves its health check somewhere else, set ' +
        '`healthCheckUrl` in deploy.toml. Set it to `false` to skip the ' +
        `check. See ${DOCS_URL}#health-check`,
    ].join('\n'),
  )
}

/**
 * The Listr task that runs the health check once the server's processes have
 * been restarted. `url` is `undefined` when there is nothing to check, which
 * leaves a task that is always skipped, so the task list keeps the same shape
 * for every server.
 */
const healthCheckTask = (
  url: string | undefined,
  ssh: SshExecutor,
  serverConfig: ServerConfig,
  nextSteps: string[],
): ListrTaskObject => {
  return {
    title: url ? `Checking ${url}...` : 'Checking health...',
    task: async (_ctx: unknown, task: { output: string }) => {
      if (!url) {
        return
      }

      await waitForHealthCheck({
        url,
        timeoutSeconds: parseInt(String(serverConfig.healthCheckTimeout), 10),
        ssh,
        serverConfig,
        nextSteps,
        onFailedAttempt: (reason) => {
          // This will only show if --verbose is passed
          task.output = reason
        },
      })
    },
    skip: () => !url,
  }
}

export const serverConfigWithDefaults = (
  serverConfig: Partial<ServerConfig>,
  yargs: BaremetalYargs,
): ServerConfig => {
  const monitor = serverConfig.monitor ?? DEFAULT_SERVER_CONFIG.monitor
  // An unknown monitor has no default command. `verifyServerConfig` reports
  // the unknown monitor itself.
  const monitorCommand =
    serverConfig.monitorCommand ??
    (isMonitor(monitor) ? MONITOR_ADAPTERS[monitor].defaultCommand : '')

  return {
    ...DEFAULT_SERVER_CONFIG,
    ...serverConfig,
    branch: yargs.branch || serverConfig.branch || DEFAULT_SERVER_CONFIG.branch,
    monitor,
    monitorCommand,
  } as ServerConfig
}

export const maintenanceTasks = (
  status: string,
  ssh: SshExecutor,
  serverConfig: ServerConfig,
) => {
  const deployPath = pathJoin(serverConfig.path, CURRENT_RELEASE_SYMLINK_NAME)
  const tasks: ListrTaskObject[] = []

  if (status === 'up') {
    tasks.push({
      title: `Enabling maintenance page...`,
      task: async () => {
        await ssh.exec(deployPath, 'cp', [
          pathJoin('web', 'dist', '200.html'),
          pathJoin('web', 'dist', '200.html.orig'),
        ])
        await ssh.exec(deployPath, 'ln', [
          SYMLINK_FLAGS,
          pathJoin('..', 'src', 'maintenance.html'),
          pathJoin('web', 'dist', '200.html'),
        ])
      },
    })

    if (serverConfig.processNames) {
      tasks.push(
        monitorTask(
          monitorAdapter(serverConfig).stop(serverConfig.processNames),
          ssh,
          serverConfig,
        ),
      )
    }
  } else if (status === 'down') {
    if (serverConfig.processNames) {
      tasks.push(
        monitorTask(
          monitorAdapter(serverConfig).start(serverConfig.processNames),
          ssh,
          serverConfig,
        ),
      )
    }

    if (serverConfig.processNames) {
      tasks.push({
        title: `Disabling maintenance page...`,
        task: async () => {
          await ssh.exec(deployPath, 'rm', [
            pathJoin('web', 'dist', '200.html'),
          ])
          await ssh.exec(deployPath, 'cp', [
            pathJoin('web', 'dist', '200.html.orig'),
            pathJoin('web', 'dist', '200.html'),
          ])
        },
      })
    }
  }

  return tasks
}

export const rollbackTasks = (
  count: number,
  ssh: SshExecutor,
  serverConfig: ServerConfig,
) => {
  let rollbackCount = 1

  if (parseInt(String(count)) === count) {
    rollbackCount = count
  }

  const tasks: ListrTaskObject[] = [
    {
      title: `Rolling back ${rollbackCount} release(s)...`,
      task: async () => {
        const currentLink = (
          await ssh.exec(serverConfig.path, 'readlink', ['-f', 'current'])
        ).stdout
          .split('/')
          .pop()
        const dirs = (await ssh.exec(serverConfig.path, 'ls', ['-t'])).stdout
          .split('\n')
          .filter((dir) => releaseDirRegExp.test(dir))

        const deployedIndex = dirs.indexOf(currentLink ?? '')

        // Rollback counts back from the active release, so it needs to be one
        // of the timestamp-named release directories
        if (deployedIndex === -1) {
          throw new Error(
            `Cannot rollback: \`current\` points to "${currentLink}", which ` +
              'is not a timestamp-named release directory',
          )
        }

        const rollbackIndex = deployedIndex + rollbackCount

        if (dirs[rollbackIndex]) {
          console.info('Setting symlink')
          await symlinkCurrentCommand(
            dirs[rollbackIndex],
            ssh,
            serverConfig.path,
          )
        } else {
          throw new Error(
            `Cannot rollback ${rollbackCount} release(s): ${
              dirs.length - deployedIndex - 1
            } previous release(s) available`,
          )
        }
      },
    },
  ]

  if (serverConfig.processNames) {
    const adapter = monitorAdapter(serverConfig)

    for (const processName of serverConfig.processNames) {
      tasks.push(monitorTask(adapter.restart(processName), ssh, serverConfig))
    }

    tasks.push(
      healthCheckTask(healthCheckUrl(serverConfig), ssh, serverConfig, [
        'The release you rolled back to is live as `current`. Check the ' +
          'process logs on the server, or run the rollback again with ' +
          '`--rollback` to move one more release back.',
      ]),
    )
  }

  return tasks
}

export const lifecycleTask = (
  lifecycle: string,
  task: string,
  skip: boolean,
  { serverLifecycle, ssh, cmdPath }: CommandConfig,
) => {
  if (serverLifecycle[lifecycle as keyof LifecycleHooks]?.[task]) {
    const tasks: ListrTaskObject[] = []

    for (const command of serverLifecycle[lifecycle as keyof LifecycleHooks][
      task
    ]) {
      tasks.push({
        title: `${titleCase(lifecycle)} ${task}: \`${command}\``,
        task: async () => {
          await ssh.exec(cmdPath, command)
        },
        skip: () => skip,
      })
    }

    return tasks
  }
}

// wraps a given command with any defined before/after lifecycle commands
export const commandWithLifecycleEvents = ({
  name,
  config,
  skip,
  command,
}: {
  name: string
  config: CommandConfig
  skip: boolean
  command: ListrTaskObject
}) => {
  const tasks: (ListrTaskObject[] | ListrTaskObject | undefined)[] = []

  tasks.push(lifecycleTask('before', name, skip, config))
  tasks.push({ ...command, skip: () => skip })
  tasks.push(lifecycleTask('after', name, skip, config))

  return tasks.flat().filter((t): t is ListrTaskObject => Boolean(t))
}

/**
 * Lists the files a Vite build manifest refers to: every chunk's output file
 * plus the CSS and other assets that chunk imports. Paths are relative to the
 * build output directory, for example `assets/index-C3xKbB2f.js`.
 */
export const manifestAssetFiles = (manifestJson: string): string[] => {
  const manifest: unknown = JSON.parse(manifestJson)
  const files = new Set<string>()

  if (!manifest || typeof manifest !== 'object') {
    return []
  }

  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    if ('file' in entry && typeof entry.file === 'string') {
      files.add(entry.file)
    }

    for (const key of ['css', 'assets'] as const) {
      if (!(key in entry) || !Array.isArray(entry[key])) {
        continue
      }

      for (const item of entry[key]) {
        if (typeof item === 'string') {
          files.add(item)
        }
      }
    }
  }

  return [...files]
}

/**
 * Reads the web build manifest of a release and returns the build output
 * directory it was found in together with the files it lists. Returns
 * `undefined` when no manifest exists in any of the build output
 * directories, for example because the release's web side was never built.
 * Throws when a manifest exists but can't be parsed.
 */
const readBuildManifest = async (ssh: SshExecutor, releasePath: string) => {
  for (const distDir of WEB_DIST_DIRS) {
    let stdout: string

    try {
      ;({ stdout } = await ssh.exec(pathJoin(releasePath, distDir), 'cat', [
        BUILD_MANIFEST_FILENAME,
      ]))
    } catch {
      continue
    }

    // Some shells print a banner before the command output (the disk space
    // check sees "Non-interactive shell detected"), so parsing starts at the
    // first `{`
    const jsonStart = stdout.indexOf('{')
    const json = jsonStart === -1 ? stdout : stdout.slice(jsonStart)

    try {
      return { distDir, files: manifestAssetFiles(json) }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new Error(
        `Could not parse ${pathJoin(releasePath, distDir, BUILD_MANIFEST_FILENAME)}: ${message}`,
      )
    }
  }

  return undefined
}

export type KeepAssetsResult =
  | { status: 'skipped'; reason: string }
  | { status: 'done'; linkedCount: number; warnings: string[] }

/**
 * Hardlinks the hashed web build output of the newest `keepReleases - 1`
 * previous releases into the new release's web build output directory.
 *
 * Cedar's router lazy-loads pages, so a browser tab that loaded an older
 * release keeps requesting that release's chunks after `current` points at
 * the new one. With the links in place those requests keep succeeding until
 * the tab's release ages out of `keepReleases`. Vite names build output by
 * content hash, so a file with the same name has the same content in every
 * release. Only files listed in a release's own build manifest are linked, so
 * a release never passes on files it received from an earlier release, and
 * the new release holds at most `keepReleases` builds' worth of assets.
 * Hardlinks share the on-disk data with the release they came from, and the
 * data stays available after that release directory is deleted.
 *
 * The result is `skipped` when the new release has no readable build
 * manifest to compare against. Problems with an individual previous release
 * are collected as warnings and don't stop the other releases from being
 * linked.
 */
export const keepPreviousAssets = async (
  yargs: BaremetalYargs,
  ssh: SshExecutor,
  serverConfig: ServerConfig,
): Promise<KeepAssetsResult> => {
  const newReleasePath = pathJoin(serverConfig.path, yargs.releaseDir)
  let newRelease: Awaited<ReturnType<typeof readBuildManifest>>

  try {
    newRelease = await readBuildManifest(ssh, newReleasePath)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    return { status: 'skipped', reason }
  }

  if (!newRelease) {
    return {
      status: 'skipped',
      reason:
        `No ${BUILD_MANIFEST_FILENAME} in ` +
        WEB_DIST_DIRS.map((dir) => pathJoin(yargs.releaseDir, dir)).join(
          ' or ',
        ),
    }
  }

  const { stdout } = await ssh.exec(serverConfig.path, 'ls')
  const previousReleases = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((dir) => releaseDirRegExp.test(dir) && dir !== yargs.releaseDir)
    .sort()
    .reverse()
    .slice(0, Math.max(serverConfig.keepReleases - 1, 0))

  const presentFiles = new Set(newRelease.files)
  const warnings: string[] = []
  let linkedCount = 0

  for (const release of previousReleases) {
    const releasePath = pathJoin(serverConfig.path, release)
    let previousRelease: Awaited<ReturnType<typeof readBuildManifest>>

    try {
      previousRelease = await readBuildManifest(ssh, releasePath)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      warnings.push(`Skipping the web assets of release ${release}: ${message}`)
      continue
    }

    if (!previousRelease) {
      warnings.push(
        `Release ${release} has no web build manifest, skipping its assets`,
      )
      continue
    }

    const missingFiles = previousRelease.files.filter(
      (file) => !presentFiles.has(file),
    )

    if (missingFiles.length === 0) {
      continue
    }

    const filesByDir = new Map<string, string[]>()

    for (const file of missingFiles) {
      const dir = path.posix.dirname(file)
      filesByDir.set(dir, [...(filesByDir.get(dir) ?? []), file])
    }

    try {
      for (const [dir, files] of filesByDir) {
        const targetDir = pathJoin(newReleasePath, newRelease.distDir, dir)

        await ssh.exec(newReleasePath, 'mkdir', ['-p', shellQuote(targetDir)])

        for (let i = 0; i < files.length; i += LINK_BATCH_SIZE) {
          const sources = files
            .slice(i, i + LINK_BATCH_SIZE)
            .map((file) =>
              shellQuote(pathJoin(releasePath, previousRelease.distDir, file)),
            )

          // `-f` replaces a link that an interrupted earlier run of this step
          // left behind. A file with the same hashed name has the same content
          // in every release, so replacing it changes nothing.
          await ssh.exec(newReleasePath, 'ln', [
            '-f',
            ...sources,
            shellQuote(targetDir),
          ])
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      warnings.push(
        `Could not keep the web assets of release ${release}: ${message}`,
      )
      continue
    }

    for (const file of missingFiles) {
      presentFiles.add(file)
    }

    linkedCount += missingFiles.length
  }

  return { status: 'done', linkedCount, warnings }
}

/**
 * Builds the list of Listr tasks for a full deploy sequence.
 */
export const deployTasks = (
  yargs: BaremetalYargs,
  ssh: SshExecutor,
  serverConfig: ServerConfig,
  serverLifecycle: LifecycleHooks,
) => {
  const cmdPath = pathJoin(serverConfig.path, yargs.releaseDir)
  const config: CommandConfig = {
    yargs,
    ssh,
    serverConfig,
    serverLifecycle,
    cmdPath,
  }
  const tasks: ListrTaskObject[] = []

  tasks.push(
    ...commandWithLifecycleEvents({
      name: 'df',
      config: { ...config, cmdPath: serverConfig.path },
      skip:
        !yargs.df ||
        serverConfig.freeSpaceRequired === 0 ||
        serverConfig.freeSpaceRequired === '0',
      command: {
        title: `Checking available disk space...`,
        task: async (
          _ctx: unknown,
          task: { output: string; skip: (msg: string) => void },
        ) => {
          const { stdout } = await ssh.exec(serverConfig.path, 'df', [
            serverConfig.path,
            '|',
            'awk',
            '\'NR == 2 {print "df:"$4}\'',
          ])

          // I'm doing this because on my machine "stdout" was:
          // 'Non-interactive shell detected\n4102880'
          // Other machines might have different output
          const df = stdout.split('\n').find((line) => line.startsWith('df:'))

          if (!df || !df.startsWith('df:') || df === 'df:') {
            return task.skip(
              c.warning('Warning: Could not get disk space information'),
            )
          }

          const dfMb = parseInt(df.replace('df:', ''), 10) / 1024

          if (isNaN(dfMb)) {
            return task.skip(
              c.warning('Warning: Could not parse disk space information'),
            )
          }

          // This will only show if --verbose is passed
          task.output = `Available disk space: ${dfMb}MB`

          const freeSpaceRequired = parseInt(
            String(serverConfig.freeSpaceRequired ?? 2048),
            10,
          )

          if (dfMb < freeSpaceRequired) {
            throw new Error(
              `Not enough disk space. You need at least ${freeSpaceRequired}` +
                `MB free space to continue. (Currently ${Math.round(dfMb)}MB ` +
                'available)',
            )
          }
        },
      },
    }),
  )

  tasks.push(
    ...commandWithLifecycleEvents({
      name: 'update',
      config: { ...config, cmdPath: serverConfig.path },
      skip: !yargs.update,
      command: {
        title: `Cloning \`${serverConfig.branch}\` branch...`,
        task: async () => {
          await ssh.exec(serverConfig.path, 'git', [
            'clone',
            `--branch=${serverConfig.branch}`,
            `--depth=1`,
            serverConfig.repo,
            yargs.releaseDir,
          ])
        },
      },
    }),
  )

  tasks.push(
    ...commandWithLifecycleEvents({
      name: 'symlinkEnv',
      config,
      skip: !yargs.update,
      command: {
        title: `Symlink .env...`,
        task: async () => {
          await ssh.exec(cmdPath, 'ln', [SYMLINK_FLAGS, '../.env', '.env'])
        },
      },
    }),
  )

  tasks.push(
    ...commandWithLifecycleEvents({
      name: 'install',
      config,
      skip: !yargs.install,
      command: {
        title: `Installing dependencies...`,
        task: async () => {
          await ssh.exec(cmdPath, serverConfig.packageManagerCommand, [
            'install',
          ])
        },
      },
    }),
  )

  tasks.push(
    ...commandWithLifecycleEvents({
      name: 'migrate',
      config,
      skip: !yargs.migrate || serverConfig?.migrate === false,
      command: {
        title: `DB Migrations...`,
        task: async () => {
          await ssh.exec(cmdPath, serverConfig.packageManagerCommand, [
            'exec',
            'cedar',
            'prisma',
            'migrate',
            'deploy',
          ])
          await ssh.exec(cmdPath, serverConfig.packageManagerCommand, [
            'exec',
            'cedar',
            'prisma',
            'generate',
          ])
          await ssh.exec(cmdPath, serverConfig.packageManagerCommand, [
            'exec',
            'cedar',
            'dataMigrate',
            'up',
          ])
        },
      },
    }),
  )

  for (const side of serverConfig.sides) {
    tasks.push(
      ...commandWithLifecycleEvents({
        name: 'build',
        config,
        skip: !yargs.build,
        command: {
          title: `Building ${side}...`,
          task: async () => {
            await ssh.exec(cmdPath, serverConfig.packageManagerCommand, [
              'exec',
              'cedar',
              'build',
              side,
            ])
          },
        },
      }),
    )
  }

  tasks.push(
    ...commandWithLifecycleEvents({
      name: 'keepAssets',
      config,
      skip:
        !yargs.keepAssets ||
        !yargs.build ||
        !serverConfig.sides.includes('web'),
      command: {
        title: `Keeping web assets of previous releases...`,
        task: async (
          _ctx: unknown,
          task: { output: string; skip: (msg: string) => void },
        ) => {
          const result = await keepPreviousAssets(yargs, ssh, serverConfig)

          if (result.status === 'skipped') {
            return task.skip(
              c.warning(
                `Warning: ${result.reason}, not keeping the web assets of ` +
                  'previous releases',
              ),
            )
          }

          // This will only show if --verbose is passed
          task.output = [
            `Linked ${result.linkedCount} file(s) from previous releases`,
            ...result.warnings.map((warning) => c.warning(warning)),
          ].join('\n')
        },
      },
    }),
  )

  tasks.push(
    ...commandWithLifecycleEvents({
      name: 'symlinkCurrent',
      config,
      skip: !yargs.update,
      command: {
        title: `Symlinking current release...`,
        task: async () => {
          await symlinkCurrentCommand(yargs.releaseDir, ssh, serverConfig.path)
        },
        skip: () => !yargs.update,
      },
    }),
  )

  if (serverConfig.processNames) {
    const adapter = monitorAdapter(serverConfig)
    const skipRestart = () => !yargs.restart

    if (yargs.firstRun) {
      const configFile = adapter.firstRunConfigFile

      if (configFile) {
        tasks.push({
          title: `Checking for ${configFile}...`,
          task: () => {
            if (!fs.existsSync(path.join(getPaths().base, configFile))) {
              throw new Error(
                `${configFile} is missing. The ${serverConfig.monitor} ` +
                  'monitor reads it when starting processes for the first ' +
                  `time. Run \`${formatCedarCommand(['setup', 'deploy', 'baremetal'])}\` ` +
                  'to generate it, or deploy without `--first-run` if the ' +
                  'processes are already running.',
              )
            }
          },
          skip: skipRestart,
        })
      }

      for (const command of adapter.firstRunSetup) {
        tasks.push(monitorTask(command, ssh, serverConfig, skipRestart))
      }
    }

    for (const processName of serverConfig.processNames) {
      if (yargs.firstRun) {
        const [firstCommand, ...followUpCommands] =
          adapter.firstRun(processName)

        if (!firstCommand) {
          continue
        }

        tasks.push(
          ...commandWithLifecycleEvents({
            name: 'restart',
            config,
            skip: !yargs.restart,
            command: monitorTask(firstCommand, ssh, serverConfig),
          }),
        )

        for (const command of followUpCommands) {
          tasks.push(monitorTask(command, ssh, serverConfig, skipRestart))
        }
      } else {
        tasks.push(
          ...commandWithLifecycleEvents({
            name: 'restart',
            config,
            skip: !yargs.restart,
            command: monitorTask(
              adapter.restart(processName),
              ssh,
              serverConfig,
            ),
          }),
        )
      }
    }

    const url = healthCheckUrl(serverConfig)

    tasks.push(
      ...commandWithLifecycleEvents({
        name: 'healthCheck',
        config: { ...config, cmdPath: serverConfig.path },
        skip: !yargs.restart || !url,
        command: healthCheckTask(url, ssh, serverConfig, [
          'The new release is live as `current`. Check the process logs ' +
            'on the server, or roll back to the previous release with ' +
            `\`${formatCedarCommand(['deploy', 'baremetal', yargs.environment, '--rollback'])}\`.`,
        ]),
      }),
    )
  }

  tasks.push(
    ...commandWithLifecycleEvents({
      name: 'cleanup',
      config: { ...config, cmdPath: serverConfig.path },
      skip: !yargs.cleanup,
      command: {
        title: `Cleaning up old deploys...`,
        task: async () => {
          // Only release directories are candidates for deletion. Anything
          // else in `serverConfig.path` (the `current` symlink, `.env`, or
          // user data such as an `uploads` directory) is left untouched.
          // `tail -n +N` starts printing at line N, so this keeps the
          // `keepReleases` newest releases. `xargs -r` skips running `rm`
          // when there is nothing to delete.
          const fileStartIndex = serverConfig.keepReleases + 1

          await ssh.exec(
            serverConfig.path,
            `ls -t | grep -E '${RELEASE_DIR_PATTERN}' | tail -n +${fileStartIndex} | xargs -r rm -rf`,
          )
        },
      },
    }),
  )

  return tasks
}

// merges additional lifecycle events into an existing object
const mergeLifecycleEvents = (
  lifecycle: LifecycleHooks,
  other: Record<string, unknown>,
): LifecycleHooks => {
  const lifecycleCopy: LifecycleHooks = JSON.parse(JSON.stringify(lifecycle))

  for (const hook of LIFECYCLE_HOOKS) {
    const otherHook = (other[hook] ?? {}) as Record<string, string[]>
    for (const key in otherHook) {
      lifecycleCopy[hook][key] = (lifecycleCopy[hook][key] || []).concat(
        otherHook[key],
      )
    }
  }

  return lifecycleCopy
}

export const parseConfig = (yargs: BaremetalYargs, rawConfigToml: string) => {
  const configToml = envInterpolation(rawConfigToml)
  const config = toml.parse(configToml) as Record<string, unknown>
  const emptyLifecycle: LifecycleHooks = { before: {}, after: {} }

  verifyConfig(config, yargs)

  // global lifecycle config
  let envLifecycle = mergeLifecycleEvents(emptyLifecycle, config)

  // get config for given environment
  const envConfig = config[yargs.environment] as Record<string, unknown>
  envLifecycle = mergeLifecycleEvents(envLifecycle, envConfig)

  return { envConfig, envLifecycle }
}

/**
 * Builds the per-server Listr task list for the deploy.
 */
export const commands = (yargs: BaremetalYargs, ssh: SshExecutor) => {
  const deployConfig = fs
    .readFileSync(pathJoin(getPaths().base, CONFIG_FILENAME))
    .toString()

  const { envConfig, envLifecycle } = parseConfig(yargs, deployConfig)
  const servers: { title: string; task: () => Listr }[] = []
  let tasks: ListrTaskObject[] = []

  // loop through each server in deploy.toml
  const serverList = (envConfig.servers ?? []) as Partial<ServerConfig>[]
  for (const config of serverList) {
    // merge in defaults
    const serverConfig = serverConfigWithDefaults(config, yargs)

    verifyServerConfig(serverConfig)

    // server-specific lifecycle
    const serverLifecycle = mergeLifecycleEvents(
      envLifecycle,
      serverConfig as unknown as Record<string, unknown>,
    )

    tasks.push({
      title: 'Connecting...',
      task: () =>
        ssh.connect({
          host: serverConfig.host,
          port: serverConfig.port,
          username: serverConfig.username,
          password: serverConfig.password,
          privateKey: serverConfig.privateKey,
          // @ts-expect-error - node-ssh Config doesn't expose privateKeyPath but it is supported at runtime
          privateKeyPath: serverConfig.privateKeyPath,
          passphrase: serverConfig.passphrase,
          agent: serverConfig.agentForward
            ? process.env.SSH_AUTH_SOCK
            : undefined,
          agentForward: serverConfig.agentForward,
        }),
    })

    if (yargs.maintenance) {
      tasks = tasks.concat(
        maintenanceTasks(yargs.maintenance, ssh, serverConfig),
      )
    } else if (yargs.rollback) {
      tasks = tasks.concat(rollbackTasks(yargs.rollback, ssh, serverConfig))
    } else {
      tasks = tasks.concat(
        deployTasks(yargs, ssh, serverConfig, serverLifecycle),
      )
    }

    tasks.push({
      title: 'Disconnecting...',
      task: () => ssh.dispose(),
    })

    // Sets each server as a "parent" task so that the actual deploy tasks
    // run as children. Each server deploy can run concurrently
    const tasksCopy = [...tasks]
    servers.push({
      title: serverConfig.host,
      task: () => {
        return new Listr(tasksCopy)
      },
    })

    tasks = []
  }

  return servers
}

export const warnIfUnpushedCommits = async () => {
  try {
    const { stdout } = await execa('git', ['log', '@{u}..', '--oneline'], {
      cwd: getPaths().base,
    })
    const unpushedCommits = stdout.trim()

    if (!unpushedCommits) {
      return
    }

    console.warn(
      c.warning('\nWarning: You have local commits that have not been pushed:'),
    )
    console.warn(
      unpushedCommits
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n'),
    )
    console.warn(
      c.warning(
        'The server will pull from the remote, so these commits will not be deployed.\n',
      ),
    )

    const { default: prompts } = await import('prompts')
    const { confirmed } = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: 'Deploy anyway?',
      initial: false,
    })

    if (!confirmed) {
      console.log('Aborting deploy. Push your commits and try again.')
      process.exit(1)
    }
  } catch (e) {
    console.error(
      c.error('\nCould not check for unpushed commits before deploying.'),
    )
    throw e
  }
}

export const handler = async (yargs: BaremetalYargs) => {
  const { SshExecutor } = await import('./SshExecutor.js')

  // Check if baremetal has been setup. The monitor's own config file, if it
  // has one, is checked by the deploy tasks that need it.
  const tomlPath = path.join(getPaths().base, CONFIG_FILENAME)

  if (!fs.existsSync(tomlPath)) {
    console.error(
      c.error('\nError: Baremetal deploy has not been properly setup.\n') +
        `Please run \`${formatCedarCommand(['setup', 'deploy', 'baremetal'])}\` before deploying`,
    )
    process.exit(1)
  }

  if (yargs.gitCheck) {
    await warnIfUnpushedCommits()
  }

  const ssh = new SshExecutor(yargs.verbose ?? false)

  try {
    const listrTasks = new Listr(commands(yargs, ssh), {
      concurrent: true,
      exitOnError: true,
      renderer: yargs.verbose ? 'verbose' : undefined,
    })
    await listrTasks.run()
  } catch (e) {
    console.error(c.error('\nDeploy failed:'))
    const errMessage =
      e instanceof Error && 'stderr' in e
        ? ((e as NodeJS.ErrnoException & { stderr?: string }).stderr ??
          e.message)
        : e instanceof Error
          ? e.message
          : String(e)
    const exitCode =
      e instanceof Error && 'exitCode' in e
        ? ((e as Error & { exitCode?: number | null }).exitCode ?? 1)
        : 1
    console.error(
      boxen(errMessage, {
        padding: { top: 0, bottom: 0, right: 1, left: 1 },
        margin: 0,
        borderColor: 'red',
      }),
    )

    process.exit(exitCode)
  }
}
