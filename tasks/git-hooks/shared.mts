import { spawn } from 'node:child_process'

export function execAsync(
  command: string,
  args: string[],
  extraEnv: Record<string, string> = {},
) {
  return new Promise<number>((resolve, reject) => {
    const isWindowsYarn = process.platform === 'win32' && command === 'yarn'
    const commandForPlatform = isWindowsYarn ? 'cmd.exe' : command
    const argsForPlatform = isWindowsYarn
      ? ['/d', '/s', '/c', 'yarn.cmd', ...args]
      : args

    const child = spawn(commandForPlatform, argsForPlatform, {
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    })
    child.on('exit', (code) => resolve(code ?? 1))
    child.on('error', reject)
  })
}
