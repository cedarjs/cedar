import execa from 'execa'

import { getPaths } from '@redmix/project-config'

import c from '../../../lib/colors.js'

export const deployHandler = async ({ build, prisma, dm: dataMigrate }) => {
  const paths = getPaths()

  let commandSet = []
  if (build) {
    commandSet.push('yarn rw build --verbose')
  }
  if (prisma) {
    commandSet.push('yarn rw prisma migrate deploy')
  }
  if (dataMigrate) {
    commandSet.push('yarn rw data-migrate up')
  }

  const joinedCommands = commandSet.join(' && ')

  console.log(c.note(`\nRunning:\n`) + `${joinedCommands} \n`)

  return execa(joinedCommands, {
    shell: true,
    stdio: 'inherit',
    cwd: paths.base,
    extendEnv: true,
    cleanup: true,
  })
}
