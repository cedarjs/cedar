import execa from 'execa'

import { getPaths } from '@cedarjs/project-config'

import c from '../../../lib/colors.js'

export const deployHandler = ({ build, prisma, dm: dataMigrate }) => {
  const paths = getPaths()

  let commandSet = []
  if (build) {
    commandSet.push('yarn cedar build --verbose')
  }
  if (prisma) {
    commandSet.push('yarn cedar prisma migrate deploy')
  }
  if (dataMigrate) {
    commandSet.push('yarn cedar data-migrate up')
  }

  const joinedCommands = commandSet.join(' && ')

  console.log(c.note('\nRunning:\n') + `${joinedCommands}\n`)

  return execa(joinedCommands, {
    shell: true,
    stdio: 'inherit',
    cwd: paths.base,
    extendEnv: true,
    cleanup: true,
  })
}
