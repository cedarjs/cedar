import process from 'node:process'

import { attw } from '../attw.js'

/**
 * Parses `--exclude-entrypoints a b c` (variadic, ends at the next `--flag`
 * or the end of argv) out of the raw CLI args.
 */
function parseExcludeEntrypoints(argv: string[]): string[] {
  const flagIndex = argv.indexOf('--exclude-entrypoints')
  if (flagIndex === -1) {
    return []
  }

  const values: string[] = []
  for (const arg of argv.slice(flagIndex + 1)) {
    if (arg.startsWith('--')) {
      break
    }
    values.push(arg)
  }

  return values
}

async function main() {
  console.log(`Running attw against: ${process.cwd()}`)

  const excludeEntrypoints = parseExcludeEntrypoints(process.argv.slice(2))
  const problems = await attw({ excludeEntrypoints })
  if (problems.length > 0) {
    console.error('Problems found:')
    for (const problem of problems) {
      console.error(problem)
    }
    process.exit(1)
  }

  console.log('No problems found')
  process.exit(0)
}

main()
