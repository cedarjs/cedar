import { spawn } from 'node:child_process'

import split from 'split2'

import { LogFormatter } from './index.js'

// Passed via env var, not a CLI arg, so the command string reaches this
// process completely untouched by shell tokenization — see the comment
// below for why that matters.
const supervisedCommand = process.env.CEDAR_LOG_FORMATTER_COMMAND

if (!supervisedCommand) {
  // No command given: format whatever's piped into stdin. Used by the
  // fallback (non `--ud`) dev job, where `cedar-log-formatter` sits at the
  // end of a shell pipe: `cedar-api-server-watch ... | cedar-log-formatter`.
  process.stdin.pipe(split(LogFormatter())).pipe(process.stdout)

  // assume that receiving a SIGINT (Ctrl-C) is a normal event, so don't exit
  // with a 129 error code, which makes execa blow up. Just return a nice
  // quiet 0.
  process.on('SIGINT', () => {
    process.exit(0)
  })
} else {
  // A command was given: spawn it, format its stdout, and exit with its
  // exit code once it finishes. Used by the `--ud` unified dev job.
  //
  // This is deliberately not implemented as a shell pipe
  // (`<command> | cedar-log-formatter`) because a shell pipeline's own exit
  // code is whatever the *last* command in it exits with — not the spawned
  // command's — so a crash in `<command>` would be silently reported as
  // success. That's fixable on POSIX with `set -o pipefail`, but not
  // uniformly: `/bin/sh` is `dash` on many Linux distros, which aborts
  // outright on an unsupported `set` option, and Windows' `cmd.exe` has no
  // pipefail equivalent at all. Spawning the command directly and reading
  // its real exit code from Node works identically on every platform.
  //
  // The command is read from an env var rather than `process.argv` because
  // it needs to survive intact through the shell that spawns *this*
  // process (`concurrently`, via `/bin/sh -c`/`cmd.exe /s /c`) and then get
  // handed to *another* shell below (`shell: true`). Once a shell tokenizes
  // a command string into argv, the original quoting is gone, and there is
  // no generally-correct way to reconstruct it (e.g. re-quoting only args
  // that contain whitespace breaks on unquoted metacharacters like `(`/`)`).
  // Env vars aren't shell-parsed at all, so the string arrives byte-for-byte
  // as `devHandler.ts` built it.
  const child = spawn(supervisedCommand, {
    // `shell: true` is required so package-manager bins (e.g. `yarn`,
    // `npx`) resolve correctly on Windows.
    shell: true,
    // stdin is inherited directly so interactive input (e.g. the `rs`
    // restart shortcut some dev servers support) still reaches the child.
    // stderr is inherited, not piped, matching the shell-pipe behavior this
    // replaces — a `|` only ever redirected stdout, never stderr.
    stdio: ['inherit', 'pipe', 'inherit'],
  })

  child.stdout?.pipe(split(LogFormatter())).pipe(process.stdout)

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    process.exit(code ?? 1)
  })

  process.on('SIGINT', () => child.kill('SIGINT'))
  process.on('SIGTERM', () => child.kill('SIGTERM'))
}
