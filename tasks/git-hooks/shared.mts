import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'

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

/**
 * Resolve the yarn command and args for the current platform.
 *
 * On Windows, Node's `spawn` with `shell: false` (the default) can't find
 * yarn when only a `.cmd` wrapper exists.  This helper detects the right
 * executable so callers can pass it to `spawn` / `execa`.
 */
export function getYarnCommand() {
  const yarnPath = process.env.npm_execpath

  if (!yarnPath) {
    return { command: 'yarn', args: [] as string[] }
  }

  const ext = path.extname(yarnPath).toLowerCase()

  if (ext === '.cmd') {
    // npm_execpath already points at a .cmd file – use it directly
    return { command: yarnPath, args: [] as string[] }
  }

  // When corepack creates the shim, npm_execpath can point at a .js / .mjs /
  // .cjs file.  On Windows we need the .cmd sibling; on Unix the shebang
  // handles it.
  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    const cmdPath = `${yarnPath}.cmd`

    if (process.platform === 'win32' && fileExists(cmdPath)) {
      return { command: cmdPath, args: [] as string[] }
    }

    return { command: process.execPath, args: [yarnPath] }
  }

  return { command: yarnPath, args: [] as string[] }
}

function fileExists(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}
