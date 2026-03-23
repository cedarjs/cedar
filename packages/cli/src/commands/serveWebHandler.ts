import {
  getPackageManager,
  runBin,
  runPackageManagerCommand,
} from '@cedarjs/cli-helpers/packageManager'
import { getPaths } from '@cedarjs/project-config'

export const webSsrServerHandler = async (rscEnabled?: boolean) => {
  await runPackageManagerCommand(
    runBin('rw-serve-fe', [], getPackageManager()),
    {
      cwd: getPaths().web.base,
      stdio: 'inherit',
      env: rscEnabled
        ? {
            ...process.env,
            // TODO (RSC): Is this how we want to do it? If so, we need to find a way
            // to merge this with users' NODE_OPTIONS
            NODE_OPTIONS: '--conditions react-server',
          }
        : undefined,
    },
  )
}
