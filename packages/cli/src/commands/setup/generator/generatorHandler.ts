import fs from 'node:fs'
import path from 'path'

import { Listr } from 'listr2'

import { colors as c } from '@cedarjs/cli-helpers'

import { getPaths } from '../../../lib/index.js'

const SIDE_MAP: Record<string, string[]> = {
  web: ['cell', 'component', 'layout', 'page', 'scaffold'],
  api: ['function', 'sdl', 'service'],
  scripts: ['script'],
  packages: ['package'],
}

const copyGenerator = (name: string, { force }: { force: boolean }) => {
  const side = Object.keys(SIDE_MAP).find((key) => SIDE_MAP[key].includes(name))

  if (!side) {
    throw new Error(`Invalid generator name: ${name}`)
  }

  const from = path.join(
    import.meta.dirname,
    '../../generate',
    name,
    'templates',
  )
  const to = path.join(getPaths().generatorTemplates, side, name)

  // copy entire template directory contents to appropriate side in app
  fs.cpSync(from, to, { recursive: true, force })

  return to
}

let destination: string

const tasks = ({ name, force }: { name: string; force: boolean }) => {
  return new Listr(
    [
      {
        title: 'Copying generator templates...',
        task: () => {
          destination = copyGenerator(name, { force })
        },
      },
      {
        title: 'Destination:',
        task: (_ctx: unknown, task: { title: string }) => {
          task.title = `  Wrote templates to ${destination.replace(
            getPaths().base,
            '',
          )}`
        },
      },
    ],
    { rendererOptions: { collapseSubtasks: false } },
  )
}

interface HandlerArgs {
  name: string
  force: boolean
}

export const handler = async ({ name, force }: HandlerArgs) => {
  const t = tasks({ name, force })

  try {
    await t.run()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.log(c.error(message))
  }
}
