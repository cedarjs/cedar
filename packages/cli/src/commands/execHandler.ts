import fs from 'node:fs'
import path from 'node:path'

import { context } from '@opentelemetry/api'
import { suppressTracing } from '@opentelemetry/core'
import { Listr } from 'listr2'
import type { ListrTask } from 'listr2'
import { Parser } from 'yargs/helpers'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { findScripts } from '@cedarjs/internal/dist/files'

import { runScriptFunction } from '../lib/exec.js'
import { generatePrismaClient } from '../lib/generatePrismaClient.js'
import { getPaths } from '../lib/index.js'

const printAvailableScriptsToConsole = () => {
  // Loop through all scripts and get their relative path
  // Also group scripts with the same name but different extensions
  const scripts = findScripts(getPaths().scripts).reduce(
    (acc: Record<string, string[]>, scriptPath: string) => {
      const relativePath = path.relative(getPaths().scripts, scriptPath)
      const ext = path.parse(relativePath).ext
      const pathNoExt = relativePath.slice(0, -ext.length)

      acc[pathNoExt] ||= []
      acc[pathNoExt].push(relativePath)

      return acc
    },
    {},
  )

  console.log('Available scripts:')
  Object.entries(scripts).forEach(([name, scriptPaths]) => {
    // If a script name exists with multiple extensions, print them all,
    // including the extension
    if (scriptPaths.length > 1) {
      scriptPaths.forEach((scriptPath) => {
        console.log(c.info(`- ${scriptPath}`))
      })
    } else {
      console.log(c.info(`- ${name}`))
    }
  })
  console.log()
}

interface ExecOptions {
  name?: string
  prisma?: boolean
  list?: boolean
  silent?: boolean
  [key: string]: unknown
}

export const handler = async (args: ExecOptions) => {
  recordTelemetryAttributes({
    command: 'exec',
    prisma: !!args.prisma,
    list: !!args.list,
  })

  const { name, prisma, list, ...scriptArgs } = args
  if (list || !name) {
    printAvailableScriptsToConsole()
    return
  }

  // The command the user is running is something like this:
  //
  // yarn cedar exec scriptName arg1 arg2 --positional1=foo --positional2=bar
  //
  // Further up in the command chain we've parsed this with yargs. We asked
  // yargs to parse the command `exec [name]`. So it plucked `scriptName` from
  // the command and placed that in a named variable called `name`.
  // And even further up the chain yargs has already eaten the `yarn` part and
  // assigned 'cedar' to `$0`
  // So what yargs has left in args._ is ['exec', 'arg1', 'arg2'] (and it has
  // also assigned 'foo' to `args.positional1` and 'bar' to `args.positional2`).
  // 'exec', 'arg1' and 'arg2' are in `args._` because those are positional
  // arguments we haven't given a name.
  // `'exec'` is of no interest to the user, as its not meant to be an argument
  // to their script. And so we remove it from the array.
  if (Array.isArray(scriptArgs._)) {
    scriptArgs._ = scriptArgs._.slice(1)
  }

  // 'cedar' is not meant for the script's args, so delete that
  delete scriptArgs.$0

  // Other arguments that yargs adds are `prisma`, `list`, `l`, `silent` and
  // `s`.
  // We eat `prisma` and `list` above. So that leaves us with `l`, `s` and
  // `silent` that we need to delete as well
  //
  // We do this *before* re-parsing anything after a literal `--` below, so
  // that if the user's script actually wants a flag called `--silent`,
  // `-s`, or `-l` after `--`, it isn't clobbered by this cleanup once it's
  // been re-parsed into `scriptArgs`.
  delete scriptArgs.l
  delete scriptArgs.s
  delete scriptArgs.silent

  // Anything the user puts after a literal `--` (e.g.
  // `yarn cedar exec myScript -- --force`) reaches us here after yargs has
  // already partially processed it: yargs stops parsing flags the moment it
  // sees `--` but still applies type coercion to positionals (e.g. '123'
  // becomes the number 123). The flag syntax itself (`--force`) is left
  // unparsed and lands as raw strings. Re-parse that tail with the same
  // parser yargs uses everywhere else, so a flag after `--` behaves the same
  // as one before it.
  //
  // Nothing before the original `--` can start with a dash by the time we
  // get here — yargs would already have parsed it as a flag — so we look
  // for the first dash-prefixed entry in `_` to find where re-parsing needs
  // to start. Plain positionals before it are left as-is in `_`, and
  // everything from that index onward (not just the dash-prefixed entry
  // itself) is spliced off into `unparsedTail` and re-parsed below. Nothing
  // is discarded — the re-parsed tail's positionals are pushed back onto
  // `_` and its flags are merged into `scriptArgs`.
  //
  // Known limitation: a positional value after `--` that itself starts with
  // a single dash and isn't purely numeric (e.g. `-file.txt`) is
  // indistinguishable from a cluster of short flags (`-f -i -l -e .txt`) and
  // will be parsed as flags rather than kept as a literal positional.
  // Negative numbers (e.g. `-5`) aren't affected — yargs coerces those to
  // `number` before this code runs, so they never hit the string check
  // below. This ambiguity isn't specific to this re-parse step; it's how
  // yargs (and getopt-style parsers generally) treat any leading-dash
  // string, so there's no way to resolve it without knowing the target
  // script's flag schema up front.
  if (Array.isArray(scriptArgs._)) {
    const dashBlockIndex = scriptArgs._.findIndex(
      (arg) => typeof arg === 'string' && arg.startsWith('-'),
    )

    if (dashBlockIndex !== -1) {
      const unparsedTail = scriptArgs._.splice(dashBlockIndex)
      const { _: reparsedPositionals, ...reparsedFlags } = Parser(unparsedTail)

      scriptArgs._.push(...reparsedPositionals)
      Object.assign(scriptArgs, reparsedFlags)
    }
  }

  const scriptPath = resolveScriptPath(name)

  if (!scriptPath) {
    console.error(
      c.error(`\nNo script called \`${name}\` in the ./scripts folder.\n`),
    )

    printAvailableScriptsToConsole()
    process.exit(1)
  }

  const scriptTasks: ListrTask[] = [
    {
      title: 'Generating Prisma client',
      enabled: () => !!prisma,
      task: () =>
        generatePrismaClient({
          verbose: !args.silent,
          silent: !!args.silent,
        }),
    },
    {
      title: 'Running script',
      task: async () => {
        try {
          await runScriptFunction({
            path: scriptPath,
            functionName: 'default',
            args: { args: scriptArgs },
          })
        } catch (error: unknown) {
          console.error(c.error('\nError in script:'))
          console.error(error)
          throw error
        }
      },
    },
  ]

  const tasks = new Listr(scriptTasks, {
    renderer: args.silent ? 'silent' : 'verbose',
  })

  // Prevent user project telemetry from within the script from being recorded
  try {
    await context.with(suppressTracing(context.active()), async () => {
      await tasks.run()
    })
  } catch {
    // yargs is configured with `.exitProcess(false)`, so promise rejections
    // from command handlers are swallowed by parseAsync() and never reach the
    // top-level catch in index.js. We must exit explicitly here.
    process.exit(1)
  }
}

function resolveScriptPath(name: string) {
  const scriptPath = path.join(getPaths().scripts, name)

  // If scriptPath already has an extension, and it's a valid path, return it
  // as it is
  if (fs.existsSync(scriptPath)) {
    return scriptPath
  }

  // These extensions match the ones in internal/src/files.ts::findScripts()
  const extensions = ['.js', '.jsx', '.ts', '.tsx']
  const matches: string[] = []

  for (const extension of extensions) {
    const candidate = scriptPath + extension

    if (fs.existsSync(candidate)) {
      matches.push(candidate)
    }
  }

  if (matches.length === 1) {
    return matches[0]
  } else if (matches.length > 1) {
    console.error(
      c.error(
        `\nMultiple scripts found for \`${name}\`. Please specify the ` +
          'extension.',
      ),
    )

    matches.forEach((match) => {
      console.log(c.info(`- ${path.relative(getPaths().scripts, match)}`))
    })

    process.exit(1)
  }

  return null
}
