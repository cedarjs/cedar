// @ts-expect-error - Types not available for JS files
import { getInstalledCedarVersion } from '../lib/index.js'

type CedarVersionArgv = Record<string, unknown> & { rwVersion?: string }

export async function detectCedarVersion(argv: CedarVersionArgv) {
  if (!argv.rwVersion) {
    return {
      rwVersion: await getInstalledCedarVersion(),
    }
  }

  return {}
}
