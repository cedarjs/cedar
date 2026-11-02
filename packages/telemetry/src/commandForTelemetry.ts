const OPTION = /^(--?)([a-zA-Z][\w-]*)/

interface YargsInternals {
  fullCommands: string[]
  declared: Record<string, unknown>
  booleans: string[]
  aliases: Record<string, string[]>
}

/**
 * Reads what yargs knows about the command that is running. Returns
 * `undefined` if `yargs` isn't a yargs instance that exposes it.
 */
function getYargsInternals(yargs: unknown): YargsInternals | undefined {
  if (
    typeof yargs !== 'object' ||
    yargs === null ||
    !('getInternalMethods' in yargs) ||
    typeof yargs.getInternalMethods !== 'function' ||
    !('getOptions' in yargs) ||
    typeof yargs.getOptions !== 'function'
  ) {
    return undefined
  }

  const context: unknown = yargs.getInternalMethods().getContext?.()
  const options: unknown = yargs.getOptions()

  if (
    typeof context !== 'object' ||
    context === null ||
    !('fullCommands' in context) ||
    !Array.isArray(context.fullCommands) ||
    typeof options !== 'object' ||
    options === null ||
    !('key' in options) ||
    typeof options.key !== 'object' ||
    options.key === null ||
    !('boolean' in options) ||
    !Array.isArray(options.boolean) ||
    !('alias' in options) ||
    typeof options.alias !== 'object' ||
    options.alias === null
  ) {
    return undefined
  }

  return {
    fullCommands: context.fullCommands.filter(
      (command): command is string => typeof command === 'string',
    ),
    // `key` and `alias` are plain objects that yargs builds from the option
    // definitions
    declared: options.key as Record<string, unknown>,
    booleans: options.boolean.filter(
      (name): name is string => typeof name === 'string',
    ),
    aliases: options.alias as Record<string, string[]>,
  }
}

function hasValue(value: unknown) {
  return value !== undefined && !(Array.isArray(value) && value.length === 0)
}

/**
 * Describes the running CLI command for telemetry, e.g.
 * `generate page [name] [path] --force` for
 * `cedar g page Payroll /payroll --force`.
 *
 * The description is built from the command's yargs definition, so it only
 * contains Cedar's own command names, positional argument names and option
 * names. Every value the user typed is replaced by a placeholder named after
 * its argument or option. Everything after `--` is left out.
 *
 * Options that a command doesn't declare are forwarded to the tool it wraps,
 * like Prisma or Vitest, and their names are kept. `exec` forwards them to
 * the user's own script, where the names can identify the user's project, so
 * for `exec` only declared options are kept.
 *
 * Returns `undefined` if `yargs` doesn't expose the running command.
 *
 * @param argv The arguments yargs parsed
 * @param yargs The yargs instance, as passed to middleware
 * @param rawArgs The arguments the user typed, without the node and script
 * paths
 */
export function commandForTelemetry(
  argv: Record<string, unknown>,
  yargs: unknown,
  rawArgs: string[],
): string | undefined {
  const internals = getYargsInternals(yargs)

  if (!internals) {
    return undefined
  }

  const { fullCommands, declared, booleans, aliases } = internals
  const parts: string[] = []

  for (const fullCommand of fullCommands) {
    const [name, ...positionals] = fullCommand.split(/\s+/)

    if (name && !name.startsWith('$')) {
      parts.push(name)
    }

    for (const positional of positionals) {
      if (!/^[<[]/.test(positional)) {
        continue
      }

      const key = positional.replace(/[<>[\].]/g, '')

      if (hasValue(argv[key])) {
        parts.push(`[${key}]`)
      }
    }
  }

  const forwardsToUserCode = parts[0] === 'exec'
  const passthroughIndex = rawArgs.indexOf('--')
  const ownArgs =
    passthroughIndex === -1 ? rawArgs : rawArgs.slice(0, passthroughIndex)

  for (const arg of ownArgs) {
    const match = arg.match(OPTION)

    if (!match) {
      continue
    }

    const [, dashes, matchedName] = match
    // A short option can have its value attached, e.g. `-dweb/dist`, so only
    // the first letter is the option's name
    const name = dashes === '-' ? matchedName[0] : matchedName
    const key =
      name.startsWith('no-') && !(name in declared) ? name.slice(3) : name

    if (forwardsToUserCode && !(key in declared)) {
      continue
    }

    if (booleans.includes(key) || typeof argv[key] === 'boolean') {
      parts.push(`${dashes}${name}`)
    } else {
      const longName =
        Object.keys(aliases).find((alias) => aliases[alias]?.includes(key)) ??
        key
      parts.push(`${dashes}${name} [${longName}]`)
    }
  }

  return parts.join(' ')
}
