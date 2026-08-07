import fs from 'node:fs'
import path from 'node:path'

import boxen from 'boxen'
import execa from 'execa'
import { Listr } from 'listr2'
import * as toml from 'smol-toml'
import { env as envInterpolation } from 'string-env-interpolation'
import { titleCase } from 'title-case'

import { colors as c } from '@cedarjs/cli-helpers'
import { formatCedarCommand } from '@cedarjs/cli-helpers/packageManager/display'
import { getPackageManager } from '@cedarjs/project-config/packageManager'

import { getPaths } from '../../../lib/index.js'

import type { SshExecutor } from './SshExecutor.js'

const CONFIG_FILENAME = 'deploy.toml'
const SYMLINK_FLAGS = '-nsf'
const CURRENT_RELEASE_SYMLINK_NAME = 'current'
const LIFECYCLE_HOOKS = ['before', 'after'] as const

export const DEFAULT_SERVER_CONFIG = {
  port: 22,
  branch: 'main',
  packageManagerCommand: getPackageManager(),
  monitorCommand: 'pm2',
  sides: ['api', 'web'],
  keepReleases: 5,
  freeSpaceRequired: 2048,
}

// force all paths to have forward slashes so that you can deploy to *nix
// systems from a Windows system
const pathJoin = path.posix.join

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
  monitorCommand: string
  sides: string[]
  processNames?: string[]
  keepReleases: number
  freeSpaceRequired: number | string
  migrate?: boolean
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

const restartProcessCommand = async (
  processName: string,
  ssh: SshExecutor,
  serverConfig: ServerConfig,
  deployPath: string,
) => {
  return await ssh.exec(deployPath, serverConfig.monitorCommand, [
    'restart',
    processName,
  ])
}

export const serverConfigWithDefaults = (
  serverConfig: Partial<ServerConfig>,
  yargs: BaremetalYargs,
): ServerConfig => {
  return {
    ...DEFAULT_SERVER_CONFIG,
    ...serverConfig,
    branch: yargs.branch || serverConfig.branch || DEFAULT_SERVER_CONFIG.branch,
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
      tasks.push({
        title: `Stopping ${serverConfig.processNames.join(', ')} processes...`,
        task: async () => {
          await ssh.exec(serverConfig.path, serverConfig.monitorCommand, [
            'stop',
            serverConfig.processNames!.join(' '),
          ])
        },
      })
    }
  } else if (status === 'down') {
    tasks.push({
      title: `Starting ${serverConfig.processNames?.join(', ')} processes...`,
      task: async () => {
        await ssh.exec(serverConfig.path, serverConfig.monitorCommand, [
          'start',
          serverConfig.processNames!.join(' '),
        ])
      },
    })

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
          .filter((dirs) => !dirs.match(/current/))

        const deployedIndex = dirs.indexOf(currentLink ?? '')
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
              dirs.length - dirs.indexOf(currentLink ?? '') - 1
            } previous release(s) available`,
          )
        }
      },
    },
  ]

  if (serverConfig.processNames) {
    for (const processName of serverConfig.processNames) {
      tasks.push({
        title: `Restarting ${processName} process...`,
        task: async () => {
          await restartProcessCommand(
            processName,
            ssh,
            serverConfig,
            serverConfig.path,
          )
        },
      })
    }
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
    for (const processName of serverConfig.processNames) {
      if (yargs.firstRun) {
        tasks.push(
          ...commandWithLifecycleEvents({
            name: 'restart',
            config,
            skip: !yargs.restart,
            command: {
              title: `Starting ${processName} process for the first time...`,
              task: async () => {
                await ssh.exec(serverConfig.path, serverConfig.monitorCommand, [
                  'start',
                  pathJoin(CURRENT_RELEASE_SYMLINK_NAME, 'ecosystem.config.js'),
                  '--only',
                  processName,
                ])
              },
            },
          }),
        )
        tasks.push({
          title: `Saving ${processName} state for future startup...`,
          task: async () => {
            await ssh.exec(serverConfig.path, serverConfig.monitorCommand, [
              'save',
            ])
          },
          skip: () => !yargs.restart,
        })
      } else {
        tasks.push(
          ...commandWithLifecycleEvents({
            name: 'restart',
            config,
            skip: !yargs.restart,
            command: {
              title: `Restarting ${processName} process...`,
              task: async () => {
                await restartProcessCommand(
                  processName,
                  ssh,
                  serverConfig,
                  serverConfig.path,
                )
              },
            },
          }),
        )
      }
    }
  }

  tasks.push(
    ...commandWithLifecycleEvents({
      name: 'cleanup',
      config: { ...config, cmdPath: serverConfig.path },
      skip: !yargs.cleanup,
      command: {
        title: `Cleaning up old deploys...`,
        task: async () => {
          // add 2 to skip `current` and start on the keepReleases + 1th release
          const fileStartIndex = serverConfig.keepReleases + 2

          await ssh.exec(
            serverConfig.path,
            `ls -t | tail -n +${fileStartIndex} | xargs rm -rf`,
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

  // Check if baremetal has been setup
  const tomlPath = path.join(getPaths().base, 'deploy.toml')
  const ecosystemPath = path.join(getPaths().base, 'ecosystem.config.js')

  if (!fs.existsSync(tomlPath) || !fs.existsSync(ecosystemPath)) {
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
