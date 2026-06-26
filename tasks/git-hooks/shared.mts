import { spawn } from 'node:child_process'

export function execAsync(
  command: string,
  args: string[],
  extraEnv: Record<string, string> = {},
) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    })
    child.on('exit', (code) => resolve(code ?? 1))
    child.on('error', reject)
  })
}
