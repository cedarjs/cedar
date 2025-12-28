import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import repl from 'node:repl'

import { registerApiSideBabelHook } from '@cedarjs/babel-config'
import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

// @ts-expect-error - Types not available for JS files
import { getPaths } from '../lib/index.js'

const paths = getPaths()

const loadPrismaClient = (replContext: Record<string, unknown>) => {
  const createdRequire = createRequire(import.meta.url)
  const { db } = createdRequire(path.join(paths.api.lib, 'db'))
  // workaround for Prisma issue: https://github.com/prisma/prisma/issues/18292
  db[Symbol.for('nodejs.util.inspect.custom')] = 'PrismaClient'
  replContext.db = db
}

const consoleHistoryFile = path.join(paths.generated.base, 'console_history')

interface REPLServerWithHistory extends repl.REPLServer {
  history: string[]
  lines: string[]
}

const persistConsoleHistory = (r: repl.REPLServer) => {
  const lines = (r as REPLServerWithHistory).lines || []
  fs.appendFileSync(
    consoleHistoryFile,
    lines.filter((line: string) => line.trim()).join('\n') + '\n',
    'utf8',
  )
}

const loadConsoleHistory = async (r: repl.REPLServer) => {
  try {
    const history = await fs.promises.readFile(consoleHistoryFile, 'utf8')
    history
      .split('\n')
      .reverse()
      .map((line) =>
        (
          r as any
        ) /* history is not in Node REPL types but exists in implementation */.history
          .push(line),
      )
  } catch {
    // We can ignore this -- it just means the user doesn't have any history yet
  }
}

export const handler = () => {
  recordTelemetryAttributes({
    command: 'console',
  })

  // Transpile on the fly
  registerApiSideBabelHook({
    plugins: [
      [
        'babel-plugin-module-resolver',
        {
          alias: {
            src: paths.api.src,
          },
        },
        'rwjs-console-module-resolver',
      ],
    ],
  })

  const r = repl.start()

  // always await promises.
  // source: https://github.com/nodejs/node/issues/13209#issuecomment-619526317
  const defaultEval = r.eval
  // @ts-expect-error - overriding eval signature
  r.eval = (cmd, context, filename, callback) => {
    defaultEval(cmd, context, filename, async (err, result) => {
      if (err) {
        // propagate errors.
        callback(err, null)
      } else {
        // await the promise and either return the result or error.
        try {
          callback(null, await Promise.resolve(result))
        } catch (err: unknown) {
          callback(err instanceof Error ? err : new Error(String(err)), null)
        }
      }
    })
  }

  // Persist console history to .redwood/console_history. See
  // https://tjwebb.medium.com/a-custom-node-repl-with-history-is-not-as-hard-as-it-looks-3eb2ca7ec0bd
  loadConsoleHistory(r)
  r.addListener('close', () => persistConsoleHistory(r))

  // Make the project's db (i.e. Prisma Client) available
  loadPrismaClient(r.context)
}
