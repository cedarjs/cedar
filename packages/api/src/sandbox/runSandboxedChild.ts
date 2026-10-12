import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { nodeModulesReadPaths } from './nodeModulesReadPaths.js'
import {
  noNetworkPreloadArg,
  permissionModelBlocksNetwork,
} from './noNetworkPreload.js'

const MIB = 1024 * 1024

/** The heap cap for a sandboxed child, in MB, unless `heapMb` is given */
export const DEFAULT_SANDBOX_HEAP_MB = 256
/** How long a sandboxed child may run, unless `timeoutMs` is given */
export const DEFAULT_SANDBOX_TIMEOUT_MS = 10_000
/** The most bytes sent to a sandboxed child, unless `maxInputBytes` is given */
export const DEFAULT_SANDBOX_MAX_INPUT_BYTES = 25 * MIB
/** The most bytes read back from a sandboxed child, unless `maxOutputBytes` is given */
export const DEFAULT_SANDBOX_MAX_OUTPUT_BYTES = 25 * MIB

/** The longest timeout `setTimeout` supports */
const MAX_TIMEOUT_MS = 2 ** 31 - 1

/** How much of the child's stderr is kept for the failure message */
const MAX_STDERR_CHARS = 4000

export interface SandboxedChildArgsOptions {
  /**
   * The Node script the child runs: a `.js`/`.mjs`/`.cjs` file, or a `.ts`
   * file Node can run by stripping its types. It may read itself.
   */
  script: string
  /**
   * Files and directories (and everything under them) the child may read
   * besides its own script and the `node_modules` folders (see
   * `nodeModulesFrom`). Everything else on disk is unreadable to the
   * child: `.env`, your app's source, uploaded files.
   */
  readable?: string[]
  /**
   * The child may read every `node_modules` folder in this folder and in
   * each folder above it, so it can import packages: the same folders Node
   * looks in for an import in a file there. Symlinked packages (workspace
   * packages) are followed to their real folders. A path, a `file:` URL,
   * or `false` for no `node_modules` at all.
   *
   * Default: the script's folder, where Node resolves the child's imports
   * from.
   */
  nodeModulesFrom?: string | URL | false
  /**
   * Whether the child may load native addons (`.node` files), as a library
   * like sharp needs. Off by default. Node's permission model does not
   * apply to native code: an addon, or an attacker who takes over one, can
   * do anything the OS lets the process do. Turn this on only for fixed,
   * known libraries, never for an addon the input could choose.
   */
  allowAddons?: boolean
  /** The child's heap cap (`--max-old-space-size`), in MB. Default 256. */
  heapMb?: number
  /** Arguments for the child script, in `process.argv.slice(2)` */
  args?: string[]
}

/**
 * The `node` command-line arguments for running `script` as a sandboxed
 * child process: Node's permission model (`--permission`) with read access
 * to `script`, the `node_modules` folders (see `nodeModulesFrom`) and
 * `readable` only, no network, a heap cap, and code generation from
 * strings (`eval`, `new Function`) turned off. No file writes, no child
 * processes, no worker threads, no WASI, no inspector, and native addons
 * only with `allowAddons`.
 *
 * On Node 25 and later the permission model blocks the network. On Node 24
 * it doesn't, so the arguments also load a preload that takes the network
 * away from JavaScript in the child (see `permissionModelBlocksNetwork()`).
 *
 * `runSandboxedChild()` uses this; it's exported for spawning the child
 * yourself (e.g. in a test probing what the child can do). Pass an empty
 * `env` when you do: the arguments restrict what the child may touch, not
 * what it inherits.
 *
 * The permission model checks the path a file is opened by, and Node opens
 * the script and the modules it imports by their real paths, so the
 * script is given by its real path, and other paths by both (an app
 * deployed behind a `current -> releases/…` symlink would otherwise be
 * refused its own files). Throws if a path doesn't exist.
 */
export const sandboxedChildArgs = ({
  script,
  readable = [],
  nodeModulesFrom,
  allowAddons = false,
  heapMb = DEFAULT_SANDBOX_HEAP_MB,
  args = [],
}: SandboxedChildArgsOptions): string[] => {
  if (!Number.isInteger(heapMb) || heapMb <= 0) {
    throw new Error(`heapMb must be a positive integer, got ${heapMb}`)
  }

  const realScript = fs.realpathSync(script)
  const nodeModules =
    nodeModulesFrom === false
      ? []
      : nodeModulesReadPaths(nodeModulesFrom ?? path.dirname(realScript))
  const readPaths = [
    ...new Set([
      realScript,
      ...nodeModules,
      // Node may read a file through the path it was given or through
      // its real path
      ...readable.flatMap((p) => [path.resolve(p), fs.realpathSync(p)]),
    ]),
  ]

  return [
    `--max-old-space-size=${heapMb}`,
    '--disallow-code-generation-from-strings',
    '--permission',
    ...(allowAddons ? ['--allow-addons'] : []),
    // Node warns that the permission model is experimental, and about
    // --allow-addons; the warnings would end up in the failure message
    '--no-warnings',
    ...readPaths.map((p) => `--allow-fs-read=${p}`),
    ...(permissionModelBlocksNetwork() ? [] : [noNetworkPreloadArg()]),
    realScript,
    ...args,
  ]
}

export interface RunSandboxedChildOptions extends SandboxedChildArgsOptions {
  /** The untrusted bytes, written to the child's stdin */
  input: Uint8Array
  /**
   * The child is killed (SIGKILL) if it hasn't exited after this many
   * milliseconds. Default 10 000. Like the byte limits, it must be a finite
   * number from 0 up; anything else (`NaN` from a missing setting, say) is
   * a `'spawn-error'` and no child is started.
   */
  timeoutMs?: number
  /**
   * Larger input is refused without starting the child. Default 25 MiB.
   */
  maxInputBytes?: number
  /**
   * The child is killed as soon as it has written more than this many bytes
   * to stdout. Default 25 MiB.
   */
  maxOutputBytes?: number
  /** The child's working directory. Default: the script's folder. */
  cwd?: string
}

/** Why a sandboxed child produced no output */
export type SandboxedChildFailure =
  /** The input was over `maxInputBytes`; no child was started */
  | 'input-too-large'
  /** The child ran past `timeoutMs` and was killed */
  | 'timeout'
  /** The child wrote more than `maxOutputBytes` and was killed */
  | 'output-too-large'
  /** The child exited non-zero or was killed by a signal */
  | 'exit'
  /** The child couldn't be started, or a limit isn't a valid number */
  | 'spawn-error'

export type SandboxedChildResult =
  | {
      ok: true
      /** Everything the child wrote to stdout */
      output: Buffer
      /** What the child wrote to stderr (the last 4000 characters) */
      stderr: string
    }
  | {
      ok: false
      failure: SandboxedChildFailure
      /** A one-line description, for a log */
      message: string
      /** What the child wrote to stderr (the last 4000 characters) */
      stderr: string
      exitCode: number | null
      signal: NodeJS.Signals | null
    }

/**
 * Runs a Node script on untrusted bytes in a locked-down (sandboxed) child
 * process, so a crafted input that exploits a parser bug lands in a process
 * that can't read your secrets or touch your files. Use it for parsing,
 * decoding or converting files your users or third parties send you:
 * resizing a photo with sharp, rendering a PDF page with pdf.js, unpacking
 * an archive, parsing a spreadsheet.
 *
 * The child:
 *
 * - gets an **empty environment** — no `DATABASE_URL`, no API keys, none of
 *   your `.env`;
 * - runs under **Node's permission model**: it may read its own script,
 *   the `node_modules` folders it imports from and the `readable` paths,
 *   nothing else; it may not write files, spawn processes, start workers,
 *   or `eval`; it may load native addons only with `allowAddons`;
 * - has **no network**: no sockets, no `fetch`, no DNS (on Node 24 through
 *   a preload, see `permissionModelBlocksNetwork()`);
 * - gets the input on **stdin**, and its **stdout** is the result, used only
 *   if it exits with code 0;
 * - is **bounded**: a heap cap, a hard timeout (SIGKILL), and caps on input
 *   and output size.
 *
 * It never rejects: every failure — a non-zero exit, a timeout, too much
 * output, a crash — is an `{ ok: false }` result with a `failure` and a
 * `message` for your log. Treat the output as untrusted too, and check it
 * (e.g. that it's really a PNG) before using it.
 *
 * Limit how many run at once with `createConcurrencyLimiter()`: each child
 * is a whole Node process.
 *
 * **This is defense in depth, not a security boundary.** Node documents
 * that its permission model does not protect against malicious code that
 * is already running in the process. None of it constrains native code: a
 * native addon (`allowAddons`), or an exploit in one, makes its own system
 * calls, so for those children what holds is the empty environment, the
 * separate process and its limits. An external binary like ffmpeg needs an
 * OS-level sandbox (a container, seccomp, a separate user).
 *
 * @example
 * ```ts
 * import {
 *   createConcurrencyLimiter,
 *   findChildScript,
 *   runSandboxedChild,
 * } from '@cedarjs/api/sandbox'
 *
 * const limit = createConcurrencyLimiter(2)
 *
 * const result = await limit(() =>
 *   runSandboxedChild({
 *     script: findChildScript(import.meta.dirname, 'resize.child'),
 *     allowAddons: true,
 *     input: uploadedBytes,
 *     timeoutMs: 10_000,
 *     maxOutputBytes: 4 * 1024 * 1024,
 *   }),
 * )
 *
 * if (result.ok) {
 *   // result.output: Buffer
 * } else {
 *   logger.warn({ failure: result.failure }, result.message)
 * }
 * ```
 */
export const runSandboxedChild = ({
  input,
  timeoutMs = DEFAULT_SANDBOX_TIMEOUT_MS,
  maxInputBytes = DEFAULT_SANDBOX_MAX_INPUT_BYTES,
  maxOutputBytes = DEFAULT_SANDBOX_MAX_OUTPUT_BYTES,
  cwd,
  ...argsOptions
}: RunSandboxedChildOptions): Promise<SandboxedChildResult> => {
  const fail = (
    failure: SandboxedChildFailure,
    message: string,
    rest: Partial<{
      stderr: string
      exitCode: number | null
      signal: NodeJS.Signals | null
    }> = {},
  ): SandboxedChildResult => ({
    ok: false,
    failure,
    message,
    stderr: rest.stderr ?? '',
    exitCode: rest.exitCode ?? null,
    signal: rest.signal ?? null,
  })

  // A limit that isn't a number (say, from a missing environment variable)
  // would turn the cap off; refuse to start instead
  const invalidLimit = [
    ['timeoutMs', timeoutMs, MAX_TIMEOUT_MS],
    ['maxInputBytes', maxInputBytes, Number.MAX_SAFE_INTEGER],
    ['maxOutputBytes', maxOutputBytes, Number.MAX_SAFE_INTEGER],
  ].find(
    ([, value, max]) =>
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > Number(max),
  )
  if (invalidLimit) {
    const [name, value, max] = invalidLimit
    return Promise.resolve(
      fail(
        'spawn-error',
        `${name} must be a number from 0 to ${max}, got ${String(value)}`,
      ),
    )
  }

  if (input.length > maxInputBytes) {
    return Promise.resolve(
      fail(
        'input-too-large',
        `input is ${input.length} bytes, over the ${maxInputBytes} byte limit`,
      ),
    )
  }

  let args: string[]
  try {
    args = sandboxedChildArgs(argsOptions)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return Promise.resolve(fail('spawn-error', message))
  }

  return new Promise((resolve) => {
    let settled = false
    let stderr = ''
    const stderrTail = () => stderr.slice(-MAX_STDERR_CHARS)
    let child: ChildProcess | undefined

    const settle = (result: SandboxedChildResult) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    // Why the child was killed. The result waits until it has exited, so a
    // concurrency limiter doesn't start the next child while this one is
    // still alive
    let killedFor: { failure: SandboxedChildFailure; message: string } | null =
      null

    const kill = (failure: SandboxedChildFailure, message: string) => {
      if (killedFor || settled) {
        return
      }
      killedFor = { failure, message }
      clearTimeout(timer)
      child?.kill('SIGKILL')
    }

    const timer = setTimeout(
      () => kill('timeout', `timed out after ${timeoutMs} ms`),
      timeoutMs,
    )

    try {
      child = spawn(process.execPath, args, {
        // Nothing of the parent's environment: no database URL, no keys
        env: {},
        cwd: cwd ?? path.dirname(fs.realpathSync(argsOptions.script)),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      settle(fail('spawn-error', message))
      return
    }

    const output: Buffer[] = []
    let outputSize = 0
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled || killedFor) {
        return
      }
      outputSize += chunk.length
      if (outputSize > maxOutputBytes) {
        kill(
          'output-too-large',
          `output is over the ${maxOutputBytes} byte limit`,
        )
        return
      }
      output.push(chunk)
    })

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_STDERR_CHARS * 2)
    })

    child.on('error', (e) => {
      // With a pid, the process exists and 'exit' settles; without one it
      // never started
      if (child?.pid === undefined) {
        settle(fail('spawn-error', e.message, { stderr: stderrTail() }))
      }
    })

    child.on('exit', (exitCode, signal) => {
      if (killedFor) {
        settle(
          fail(killedFor.failure, killedFor.message, {
            stderr: stderrTail(),
            exitCode,
            signal,
          }),
        )
      }
    })

    child.on('close', (exitCode, signal) => {
      // The output can go over the cap (or the timer fire) after the child
      // has exited, while its last output is still being read: that's
      // still a failure, never a cut-off output reported as success
      if (killedFor) {
        settle(
          fail(killedFor.failure, killedFor.message, {
            stderr: stderrTail(),
            exitCode,
            signal,
          }),
        )
        return
      }
      if (exitCode === 0) {
        settle({
          ok: true,
          output: Buffer.concat(output),
          stderr: stderrTail(),
        })
        return
      }
      const lastLine =
        stderrTail()
          .trim()
          .split('\n')
          .filter((line) => line.trim())
          .pop() ?? ''
      settle(
        fail(
          'exit',
          `exited with ${exitCode ?? signal}${lastLine ? `: ${lastLine}` : ''}`,
          { stderr: stderrTail(), exitCode, signal },
        ),
      )
    })

    // The child may exit before reading all of its input (e.g. it refused
    // it); writing the rest then fails with EPIPE, which isn't an error here
    child.stdin?.on('error', () => {})
    child.stdin?.end(input)
  })
}
