import path from 'path'

import ansis from 'ansis'
import fs from 'fs-extra'
import { terminalLink } from 'termi-link'

import { getPaths } from '../../lib/index.js'
import { isTypeScriptProject, serverFileExists } from '../../lib/project.js'

const link = (topicId, isTerminal = false) => {
  const communityLink = `https://community.redwoodjs.com/t/${topicId}`
  if (isTerminal) {
    return terminalLink(communityLink, communityLink)
  } else {
    return communityLink
  }
}

export const getEpilogue = (
  command,
  description,
  topicId,
  isTerminal = false,
) =>
  `This is an experimental feature to: ${description}.\n\nPlease find documentation and links to provide feedback for ${command} at:\n -> ${link(
    topicId,
    isTerminal,
  )}`

export const printTaskEpilogue = (command, description, topicId) => {
  console.log(
    `${ansis.hex('#ff845e')(
      `------------------------------------------------------------------\n 🧪 ${ansis.green(
        'Experimental Feature',
      )} 🧪\n------------------------------------------------------------------`,
    )}`,
  )
  console.log(getEpilogue(command, description, topicId, false))

  console.log(
    `${ansis.hex('#ff845e')(
      '------------------------------------------------------------------',
    )}\n`,
  )
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
        'Please run `yarn cedarjs setup realtime` first.',
    )
  }

  return true
}
