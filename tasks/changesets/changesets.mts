import fs from 'node:fs'
import path from 'node:path'

import ansis from 'ansis'

import {
  getChangesetFilePath,
  getPlaceholder,
  resolveArgv,
  shouldShowHelp,
  showHelp,
} from './changesetsHelpers.mjs'

async function main() {
  if (shouldShowHelp()) {
    showHelp()
    return
  }

  const { prNumber } = await resolveArgv()

  const changesetFilePath = getChangesetFilePath(prNumber)
  const placeholder = await getPlaceholder(prNumber)
  fs.mkdirSync(path.dirname(changesetFilePath), { recursive: true })
  await fs.promises.writeFile(changesetFilePath, placeholder)
  console.log(
    [
      `📝 Created a changeset at ${ansis.magenta(changesetFilePath)}`,
      "   Commit it when you're done and push your branch up to GitHub. Thank you! 🙏",
    ].join('\n'),
  )
}

try {
  await main()
} catch (error) {
  if (error && typeof error === 'object' && 'message' in error) {
    console.error(`${error.message}\n`)
  }

  showHelp()
  process.exitCode = 1
}

// Test suite
//
// - should be the placeholder at ./placeholder.md
//   - yarn changesets
//
// - should be the title and body of PR 10075
//   - yarn changesets 10075
//   - yarn changesets '#10075'
//
// - should throw and show help
//   - yarn changesets abcd
//   - yarn changesets 10075000
//   - yarn changesets https://github.com/redwoodjs/redwood/pull/10075
