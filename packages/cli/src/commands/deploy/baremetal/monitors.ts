/**
 * Process monitors that `cedar deploy baremetal` can drive. Each adapter turns
 * the deploy's process operations into the commands its monitor understands.
 * Steady-state restarts, and the stop/start around the maintenance page, are
 * single commands on every monitor. Starting a process for the first time
 * differs in shape: pm2 starts from its ecosystem config file and then has to
 * `save` the process list to survive reboots, while systemd reloads its unit
 * files once and then enables and starts each unit in a single call.
 */

export const MONITORS = ['pm2', 'systemd-user', 'systemd-system'] as const

export type Monitor = (typeof MONITORS)[number]

/** One command to run on the server, as arguments appended to `monitorCommand` */
export interface MonitorCommand {
  title: string
  args: string[]
}

export interface MonitorAdapter {
  /** Command the adapter runs when `monitorCommand` isn't set in deploy.toml */
  defaultCommand: string
  /**
   * File in the project that the monitor reads when starting processes for the
   * first time, if any. The deploy checks that it exists before a first run.
   */
  firstRunConfigFile?: string
  /** Commands to run once before any process is started for the first time */
  firstRunSetup: MonitorCommand[]
  /**
   * Commands that start a process for the first time and make it start again
   * after a reboot. The first command is wrapped in the `restart` lifecycle
   * hooks.
   */
  firstRun: (processName: string) => MonitorCommand[]
  restart: (processName: string) => MonitorCommand
  stop: (processNames: string[]) => MonitorCommand
  start: (processNames: string[]) => MonitorCommand
}

const pm2: MonitorAdapter = {
  defaultCommand: 'pm2',
  firstRunConfigFile: 'ecosystem.config.js',
  firstRunSetup: [],
  firstRun: (processName) => [
    {
      title: `Starting ${processName} process for the first time...`,
      args: ['start', 'current/ecosystem.config.js', '--only', processName],
    },
    {
      title: `Saving ${processName} state for future startup...`,
      args: ['save'],
    },
  ],
  restart: (processName) => ({
    title: `Restarting ${processName} process...`,
    args: ['restart', processName],
  }),
  stop: (processNames) => ({
    title: `Stopping ${processNames.join(', ')} processes...`,
    args: ['stop', ...processNames],
  }),
  start: (processNames) => ({
    title: `Starting ${processNames.join(', ')} processes...`,
    args: ['start', ...processNames],
  }),
}

const systemd = (defaultCommand: string): MonitorAdapter => ({
  defaultCommand,
  firstRunSetup: [
    {
      title: 'Reloading systemd unit files...',
      args: ['daemon-reload'],
    },
  ],
  firstRun: (processName) => [
    {
      title: `Enabling and starting ${processName} for the first time...`,
      args: ['enable', '--now', processName],
    },
  ],
  restart: (processName) => ({
    title: `Restarting ${processName}...`,
    args: ['restart', processName],
  }),
  stop: (processNames) => ({
    title: `Stopping ${processNames.join(', ')}...`,
    args: ['stop', ...processNames],
  }),
  start: (processNames) => ({
    title: `Starting ${processNames.join(', ')}...`,
    args: ['start', ...processNames],
  }),
})

export const MONITOR_ADAPTERS: Record<Monitor, MonitorAdapter> = {
  pm2,
  'systemd-user': systemd('systemctl --user'),
  'systemd-system': systemd('sudo systemctl'),
}

export const isMonitor = (value: unknown): value is Monitor =>
  typeof value === 'string' && (MONITORS as readonly string[]).includes(value)
