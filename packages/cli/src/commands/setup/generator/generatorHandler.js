import fs from 'node:fs'
import path from 'path'

import { Listr } from 'listr2'

import c from '../../../lib/colors.js'
import { getPaths } from '../../../lib/index.js'

const SIDE_MAP = {
  web: ['cell', 'component', 'layout', 'page', 'scaffold'],
  api: ['function', 'sdl', 'service'],
  scripts: ['script'],
}

const copyGenerator = (name, { force }) => {
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

let destination

const tasks = ({ name, force }) => {
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
        task: (ctx, task) => {
          task.title = `  Wrote templates to ${destination.replace(
            getPaths().base,
            '',
          )}`
        },
      },
    ],
    { rendererOptions: { collapseSubtasks: false }, errorOnExist: true },
  )
}

export const handler = async ({ name, force }) => {
  const t = tasks({ name, force })

  try {
    await t.run()
  } catch (e) {
    console.log(c.error(e.message))
  }
}
