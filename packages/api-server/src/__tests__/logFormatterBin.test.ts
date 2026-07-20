import { spawn } from 'node:child_process'
import path from 'node:path'

import { describe, it, expect } from 'vitest'

// Exercises the built bin directly (like dist.test.ts) rather than importing
// bin.ts, since it has top-level side effects (spawns a child process, may
// call `process.exit`) that would be unsafe to run in-process inside the
// test runner.
const binPath = path.join(
  import.meta.dirname,
  '..',
  '..',
  'dist',
  'logFormatter',
  'bin.js',
)

// bin.ts hands this straight to `spawn(command, { shell: true })`, so it
// needs to already be a valid shell command string.
function shQuote(arg: string) {
  return `"${arg.replace(/"/g, '\\"')}"`
}

function buildSupervisedCommand(...args: string[]) {
  return args.map(shQuote).join(' ')
}

function runBin(supervisedCommand?: string, input?: string) {
  return new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn(process.execPath, [binPath], {
      env: {
        ...process.env,
        ...(supervisedCommand
          ? { CEDAR_LOG_FORMATTER_COMMAND: supervisedCommand }
          : { CEDAR_LOG_FORMATTER_COMMAND: '' }),
      },
      stdio: ['pipe', 'pipe', 'inherit'],
    })

    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.on('exit', (code) => resolve({ code, stdout }))

    if (input !== undefined) {
      child.stdin.write(input)
    }
    child.stdin.end()
  })
}

describe('cedar-log-formatter bin', () => {
  describe('given a command to supervise (CEDAR_LOG_FORMATTER_COMMAND)', () => {
    it('exits with the spawned command exit code on success', async () => {
      const { code } = await runBin(
        buildSupervisedCommand(process.execPath, '-e', 'process.exit(0)'),
      )

      expect(code).toEqual(0)
    })

    it('exits with the spawned command exit code on failure, instead of masking it', async () => {
      const { code } = await runBin(
        buildSupervisedCommand(process.execPath, '-e', 'process.exit(7)'),
      )

      expect(code).toEqual(7)
    })

    it('formats pino NDJSON written by the spawned command', async () => {
      const { stdout } = await runBin(
        buildSupervisedCommand(
          process.execPath,
          '-e',
          `console.log(JSON.stringify({ level: 30, msg: 'hi there', time: 1 }))`,
        ),
      )

      expect(stdout).toContain('hi there')
      expect(stdout).not.toContain('"level":30')
    })

    it('passes through non-pino output from the spawned command unchanged', async () => {
      const { stdout } = await runBin(
        buildSupervisedCommand(
          process.execPath,
          '-e',
          `console.log('plain output')`,
        ),
      )

      expect(stdout).toContain('plain output')
    })
  })

  describe('given no command (stdin mode)', () => {
    it('formats pino NDJSON piped into stdin', async () => {
      const { stdout, code } = await runBin(
        undefined,
        JSON.stringify({ level: 30, msg: 'via stdin', time: 1 }) + '\n',
      )

      expect(stdout).toContain('via stdin')
      expect(code).toEqual(0)
    })
  })
})
