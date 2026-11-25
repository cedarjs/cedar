import fs from 'node:fs'
import os from 'node:os'

/** The package manager running the current process, like Yarn or npm */
export interface PackageManagerInfo {
  /** As the package manager names itself, like `yarn`, `npm` or `pnpm` */
  name: string
  version: string
}

function readFile(filePath: string) {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

/**
 * The name and version of the operating system, like `macOS 15.2`,
 * `Linux 6.8 Ubuntu 24.04.1 LTS (Noble Numbat)` or `Windows 11 10.0.22631`
 */
export function getOsName(): string {
  const platform = os.platform()
  const release = os.release()

  if (platform === 'darwin') {
    const systemVersion = readFile(
      '/System/Library/CoreServices/SystemVersion.plist',
    )
    const version = systemVersion.match(
      /<key>ProductVersion<\/key>\s*<string>([^<]+)<\/string>/,
    )?.[1]

    return version ? `macOS ${version}` : 'macOS'
  }

  if (platform === 'linux') {
    const kernel = release.replace(/^(\d+\.\d+).*/, '$1')
    const distro = getLinuxDistro()
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

/** The distro's name and version from `/etc/os-release`, like `Debian GNU/Linux 12 (bookworm)` */
function getLinuxDistro() {
  const osRelease = readFile('/etc/os-release')

  const name = osRelease.match(/^NAME="?([^"\n]+)"?$/m)?.[1] ?? ''
  const version = osRelease.match(/^VERSION="?([^"\n]+)"?$/m)?.[1] ?? ''

  return `${name} ${version}`.trim()
}

/** The path to the user's shell, from `$SHELL` */
export function getShellPath(): string | undefined {
  return process.env.SHELL || undefined
}

/**
 * The package manager that started this process, from the
 * `npm_config_user_agent` environment variable that Yarn, npm, pnpm and Bun
 * set for the scripts and binaries they run
 */
export function getPackageManager(): PackageManagerInfo | undefined {
  // Like `yarn/4.14.1 npm/? node/v24.11.0 darwin arm64`
  const userAgent = process.env.npm_config_user_agent ?? ''
  const match = userAgent.match(/^([a-z]+)\/(\d\S*)/)

  if (!match) {
    return undefined
  }

  return { name: match[1], version: match[2] }
}
