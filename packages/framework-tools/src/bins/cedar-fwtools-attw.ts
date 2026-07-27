import process from 'node:process'
import { parseArgs } from 'node:util'

import { attw } from '../attw.js'

async function main() {
  console.log(`Running attw against: ${process.cwd()}`)

  // `--exclude-entrypoints a --exclude-entrypoints b` to exclude both a and b
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
