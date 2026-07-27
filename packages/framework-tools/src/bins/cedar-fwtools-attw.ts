import process from 'node:process'
import { parseArgs } from 'node:util'

import { attw } from '../attw.js'

async function main() {
  console.log(`Running attw against: ${process.cwd()}`)

  // Repeat the flag for multiple entrypoints, e.g.
  // `--exclude-entrypoints a --exclude-entrypoints b` -- unlike `attw`'s own
  // CLI, `parseArgs` doesn't collect a space-separated list after one
  // occurrence of the flag.
  const { values } = parseArgs({
    options: {
      'exclude-entrypoints': { type: 'string', multiple: true, default: [] },
    },
  })

  const problems = await attw({
    excludeEntrypoints: values['exclude-entrypoints'],
  })
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
