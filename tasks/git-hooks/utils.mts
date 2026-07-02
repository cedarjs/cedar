import { spawn, spawnSync } from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'

export function isOnReleaseBranch(): boolean {
  const { stdout } = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf-8',
  })
  const currentBranch = stdout.trim()

  return currentBranch === 'next' || currentBranch.startsWith('release/')
}

/**
 * Escape a filename for safe use in a cmd.exe command string.
 * Inside double quotes, `"` needs escaping as `""`, and `%` needs escaping
 * as `%%` to prevent environment variable expansion.
 */
export function sanitizeArg(arg: string): string {
  return `"${arg.replace(/"/g, '""').replace(/%/g, '%%')}"`
}

/**
 * Build a command string for Windows cmd.exe from a command and args array.
 */
export function buildWindowsCommand(command: string, args: string[]): string {
  return `${command} ${args.map((a) => sanitizeArg(a)).join(' ')}`
}

/**
 * Cross-platform spawn
 *
 * On Unix: passes args array directly, no shell.
 * On Windows: builds a command string and uses shell: true (needed so cmd.exe
 * can resolve `yarn` → `yarn.cmd` via PATHEXT). This avoids DEP0190 since we
 * pass a string, not an args array.
 *
 * Returns a promise that resolves with the exit code and captured stderr.
 * stderr is piped (not inherited) so callers can log it on failure.
 */
function spawnSafe(
  command: string,
  args: string[],
  options?: SpawnOptions,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const stderrChunks: Buffer[] = []

    const opts: SpawnOptions = {
      stdio: ['inherit', 'inherit', 'pipe'],
      ...options,
    }

    let child: ReturnType<typeof spawn>

    if (process.platform === 'win32') {
      const cmd = buildWindowsCommand(command, args)
      child = spawn(cmd, { ...opts, shell: true })
    } else {
      child = spawn(command, args, opts)
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })

    child.on('exit', (code) => {
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim()
      resolve({ code, stderr })
    })

    child.on('error', reject)
  })
}

/**
 * Convenience wrapper around spawnSafe that logs diagnostics and throws on
 * failure. The thrown error has an `exitCode` property with the actual exit
 * code from the child process.
 */
export async function execAsync(
  command: string,
  args: string[],
  tag: string,
  options?: { env?: Record<string, string>; cwd?: string },
): Promise<void> {
  const label = `${command} ${args.join(' ')}`

  try {
    const { code, stderr } = await spawnSafe(command, args, {
      env: options?.env ? { ...process.env, ...options.env } : undefined,
      cwd: options?.cwd,
    })

    if (code !== 0) {
      console.error(
        `[${tag}] command failed (exit ${code ?? 'null'}): ${label}\n` +
          `  stderr: ${stderr || '<no stderr>'}`,
      )
      const err = new Error(`[${tag}] command exited with status ${code}`)
      ;(err as Error & { exitCode: number }).exitCode = code ?? 1
      throw err
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith(`[${tag}] command exited with status`)
    ) {
      throw err
    }
    console.error(
      `[${tag}] command failed to spawn: ${label}\n` +
        `  error: ${err instanceof Error ? err.message : err}`,
    )
    throw err instanceof Error ? err : new Error(String(err))
  }
}
