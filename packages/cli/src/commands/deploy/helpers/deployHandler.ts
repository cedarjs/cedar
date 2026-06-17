import execa from 'execa'

import { colors as c } from '@cedarjs/cli-helpers'
import { formatCedarCommand } from '@cedarjs/cli-helpers/packageManager/display'
import { getPaths } from '@cedarjs/project-config'

export const deployHandler = ({
  build,
  prisma,
  dm: dataMigrate,
}: {
  build: boolean
  prisma: boolean
  dm: boolean
}) => {
  const paths = getPaths()

  const commandSet: string[] = []
  if (build) {
    commandSet.push(formatCedarCommand(['build', '--verbose']))
  }
  if (prisma) {
    commandSet.push(formatCedarCommand(['prisma', 'migrate', 'deploy']))
  }
  if (dataMigrate) {
    commandSet.push(formatCedarCommand(['data-migrate', 'up']))
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
