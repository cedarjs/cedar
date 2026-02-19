// @ts-expect-error - Types not available for JS files
import { getInstalledCedarVersion } from '../lib/index.js'

type RxVersionArgv = Record<string, unknown> & { rwVersion?: string }

export default async function detectRxVersion(argv: RxVersionArgv) {
  if (!argv.rwVersion) {
    return {
      rwVersion: await getInstalledCedarVersion(),
    }
  }

  return {}
}
