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
  const { db } = createdRequire(path.join(paths.api.lib, 'db')) as {
    db: Record<string | symbol, unknown>
  }
  // workaround for Prisma issue: https://github.com/prisma/prisma/issues/18292
  db[Symbol.for('nodejs.util.inspect.custom')] = 'PrismaClient'
  replContext.db = db
}

const consoleHistoryFile = path.join(paths.generated.base, 'console_history')
const persistConsoleHistory = (r: any) => {
  fs.appendFileSync(
    consoleHistoryFile,
    r.lines.filter((line: string) => line.trim()).join('\n') + '\n',
    'utf8',
  )
}

const loadConsoleHistory = async (r: any) => {
  try {
    const history = await fs.promises.readFile(consoleHistoryFile, 'utf8')
    history
      .split('\n')
      .reverse()
      .map((line) => r.history.push(line))
  } catch {
    // We can ignore this -- it just means the user doesn't have any history yet
  }
}

export const handler = (_options?: Record<string, unknown>) => {
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

  const r = repl.start() as any

  // always await promises.
  // source: https://github.com/nodejs/node/issues/13209#issuecomment-619526317
  const defaultEval = r.eval
  r.eval = (cmd: string, context: any, filename: string, callback: any) => {
    defaultEval.call(
      r,
      cmd,
      context,
      filename,
      async (err: Error | null, result: unknown) => {
        if (err) {
          callback(err)
        } else {
          try {
            callback(null, await Promise.resolve(result))
          } catch (error) {
            callback(error as Error)
          }
        }
      },
    )
  }

  loadConsoleHistory(r)
  r.addListener('close', () => persistConsoleHistory(r))

  loadPrismaClient(r.context)
}
