import { exec, execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * A tool found on the machine. `path` is where it was found on `PATH`, if it
 * was found there
 */
export interface ToolInfo {
  version: string
  path?: string
}

const VERSION_REGEX = /\d+\.[\d+|.]+/

/** The first version-looking part of `output`, or all of it if there's none */
function findVersion(output: string) {
  return output.match(VERSION_REGEX)?.[0] ?? output
}

/** Runs `command` in a shell. Resolves to its trimmed stdout, or `''` on error */
function run(command: string): Promise<string> {
  return new Promise((resolve) => {
    exec(command, (error, stdout) => {
      resolve(error ? '' : stdout.toString().trim())
    })
  })
}

/**
 * Runs `file` without a shell. Resolves to its trimmed stdout (and stderr, if
 * `withStderr` is set), or `''` on error
 */
function runFile(
  file: string,
  args: string[],
  { withStderr = false } = {},
): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, (error, stdout, stderr) => {
      if (error) {
        resolve('')
        return
      }

      const output = withStderr
        ? stdout.toString() + stderr.toString()
        : stdout.toString()

      resolve(output.trim())
    })
  })
}

async function isExecutableFile(filePath: string) {
  try {
    const mode =
      process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK
    await fs.promises.access(filePath, mode)

    return (await fs.promises.stat(filePath)).isFile()
  } catch {
    return false
  }
}

/** Where `command` is found on `PATH`, like the `which` shell command */
async function which(command: string): Promise<string | undefined> {
  if (!command) {
    return undefined
  }

  const isWindows = process.platform === 'win32'
  const hasSeparator = isWindows ? /[\\/]/.test(command) : command.includes('/')

  const dirs = hasSeparator
    ? ['']
    : [
        ...(isWindows ? [process.cwd()] : []),
        ...(process.env.PATH ?? '')
          .split(path.delimiter)
          .map((dir) => dir.replace(/^"(.*)"$/, '$1'))
          .filter(Boolean),
      ]

  const extensions = isWindows
    ? [
        ...(command.includes('.') ? [''] : []),
        ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .filter(Boolean),
      ]
    : ['']

  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, command + extension)

      if (await isExecutableFile(candidate)) {
        return candidate
      }
    }
  }

  return undefined
}

function toToolInfo(version: string, toolPath: string | undefined) {
  if (!version) {
    return undefined
  }

  return toolPath ? { version, path: toolPath } : { version }
}

/**
 * The name and version of the operating system, like `macOS 15.2`,
 * `Linux 6.8 Ubuntu 24.04.1 LTS` or `Windows 11 10.0.22631`
 */
export async function getOsName(): Promise<string> {
  const platform = os.platform()
  const release = os.release()

  if (platform === 'darwin') {
    // Node 24 only runs on macOS releases that are all named "macOS"
    const version = await run('sw_vers -productVersion')

    return version ? `macOS ${version}` : 'macOS'
  }

  if (platform === 'linux') {
    const kernel = release.replace(/^(\d+\.\d+).*/, '$1')
    const distro = await getLinuxDistro()
    const name = kernel ? `Linux ${kernel}` : 'Linux'

    return distro ? `${name} ${distro}` : name
  }

  if (platform === 'win32') {
    // Node 24 only runs on Windows 10 and later
    const [major, minor, build] = release.split('.')
    const isWindows11 =
      major === '10' && minor === '0' && Number(build) >= 22000

    return `${isWindows11 ? 'Windows 11' : 'Windows 10'} ${release}`
  }

  return platform
}

async function getLinuxDistro() {
  let osRelease = ''

  try {
    osRelease = await fs.promises.readFile('/etc/os-release', 'utf8')
  } catch {
    return ''
  }

  // The first `NAME="..."` is usually part of `PRETTY_NAME="..."`
  const name = osRelease.match(/NAME="(.+)"/)?.[1] ?? ''
  const version = osRelease.match(/VERSION="(.+)"/)?.[1] ?? ''

  return `${name} ${version}`.trim()
}

/**
 * The user's shell, from `$SHELL` or else their login shell. Not available
 * on Windows
 */
export async function getShellInfo(): Promise<ToolInfo | undefined> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return undefined
  }

  const shell =
    process.env.SHELL ||
    (await run('getent passwd $LOGNAME | cut -d: -f7 | head -1'))

  // BusyBox's ash has no `--version`, but prints its version with `--help`
  const versionArg = shell.includes('/bin/ash') ? '--help' : '--version'

  const [output, shellPath] = await Promise.all([
    shell ? runFile(shell, [versionArg], { withStderr: true }) : '',
    which(shell),
  ])

  return toToolInfo(findVersion(output) || 'Unknown', shellPath)
}

/** The `node` on `PATH`, which isn't necessarily the one running this code */
export async function getNodeInfo(): Promise<ToolInfo | undefined> {
  const nodePath = await which('node')

  const output =
    process.platform === 'win32'
      ? await run('node -v')
      : nodePath
        ? await runFile(nodePath, ['-v'])
        : ''

  return toToolInfo(findVersion(output), nodePath)
}

/** The `yarn` on `PATH`, as it reports itself in the current directory */
export async function getYarnInfo(): Promise<ToolInfo | undefined> {
  const [version, yarnPath] = await Promise.all([run('yarn -v'), which('yarn')])

  return toToolInfo(version, yarnPath)
}

/** The `npm` on `PATH` */
export async function getNpmInfo(): Promise<ToolInfo | undefined> {
  const [version, npmPath] = await Promise.all([run('npm -v'), which('npm')])

  return toToolInfo(version, npmPath)
}

/** VS Code's `code` command on `PATH` */
export async function getVSCodeInfo(): Promise<ToolInfo | undefined> {
  const [output, codePath] = await Promise.all([
    run('code --version'),
    which('code'),
  ])

  return toToolInfo(findVersion(output), codePath)
}
