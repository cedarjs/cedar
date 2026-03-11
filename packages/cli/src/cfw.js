#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

import Configstore from 'configstore'
import execa from 'execa'
import { terminalLink } from 'termi-link'

import { getConfigPath } from '@cedarjs/project-config'

const config = new Configstore('@cedarjs/cli')

// TODO: Remove RW related fallbacks here
const CFW_PATH =
  process.env.CFW_PATH ||
  process.env.RWFW_PATH ||
  process.env.RW_PATH ||
  config.get('CFW_PATH') ||
  config.get('RWFW_PATH')

if (!CFW_PATH) {
  console.error('Error: You must specify the path to Cedar Framework')
  console.error('Usage: `CFW_PATH=~/gh/cedarjs/cedar yarn cfw <command>')
  process.exit(1)
}

if (!fs.existsSync(CFW_PATH)) {
  console.error(
    `Error: The specified path to Cedar Framework (${CFW_PATH}) does not exist.`,
  )
  console.error('Usage: `CFW_PATH=~/gh/cedarjs/cedar yarn cfw <command>')
  process.exit(1)
}

const absCfwPath = path.resolve(process.cwd(), CFW_PATH)
config.set('CFW_PATH', absCfwPath)

// Execute the commands in the Cedar Framework Tools package.
const projectPath = path.dirname(
  getConfigPath(process.env.CEDAR_CWD ?? process.env.RWJS_CWD ?? process.cwd()),
)
console.log('Cedar Framework Tools Path:', terminalLink(absCfwPath, absCfwPath))

let command = process.argv.slice(2)
const helpCommands = ['help', '--help']
if (!command.length || command.some((cmd) => helpCommands.includes(cmd))) {
  command = ['run']
}

try {
  // This used to look like `execa.sync('yarn', [...command], {`, but then Node
  // deprecated passing args in that way.
  // See https://nodejs.org/api/deprecations.html#DEP0190
  execa.sync('yarn', [...command], {
    stdio: 'inherit',
    cwd: absCfwPath,
    env: {
      CEDAR_CWD: projectPath,
    },
  })
} catch (e) {
  console.log()
  //
}
