import fs from 'node:fs'
import path from 'node:path'

import ansis from 'ansis'
import { terminalLink } from 'termi-link'

import { getPaths } from '../../lib/index.js'
import { isTypeScriptProject, serverFileExists } from '../../lib/project.js'

function link(topicId, isTerminal = false) {
  const communityLink = `https://community.redwoodjs.com/t/${topicId}`

  if (isTerminal) {
    return terminalLink(communityLink, communityLink)
  } else {
    return communityLink
  }
}

export function getEpilogue(command, description, topicId, isTerminal = false) {
  let epilogue =
    `This is an experimental feature to: ${description}.\n\n` +
    `If you need help with ${command}, please join our Discord community.\n` +
    ` -> ${terminalLink('', 'https://cedarjs.com/discord')}`

  if (topicId) {
    epilogue +=
      '\n\nYou might also be able to find some information at:\n' +
      ` -> ${link(topicId, isTerminal)}`
  }

  return epilogue
}

export function printTaskEpilogue(command, description, topicId) {
  const orangeLine = ansis.hex('#ff845e')('-'.repeat(64))

  console.log(
    [
      orangeLine,
      `🧪 ${ansis.green('Experimental Feature')} 🧪`,
      orangeLine,
    ].join('\n'),
  )
  console.log(getEpilogue(command, description, topicId, false))
  console.log(`${orangeLine}\n`)
}

export const isServerFileSetup = () => {
  if (!serverFileExists()) {
    throw new Error(
      'CedarJS Realtime requires a serverful environment. Please run `yarn ' +
        'cedarjs setup server-file` first.',
    )
  }

  return true
}

export const realtimeExists = () => {
  const realtimePath = path.join(
    getPaths().api.lib,
    `realtime.${isTypeScriptProject() ? 'ts' : 'js'}`,
  )
  return fs.existsSync(realtimePath)
}

export const isRealtimeSetup = () => {
  if (!realtimeExists()) {
    throw new Error(
      'Adding realtime events requires that CedarJS Realtime is setup. ' +
        'Please run `yarn cedar setup realtime` first.',
    )
  }

  return true
}
