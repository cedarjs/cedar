import semver from 'semver'

import { colors as c } from '@cedarjs/cli-helpers'

interface NodeVersionCheck {
  ok: boolean
  message?: string
}

export function checkNodeVersion(): NodeVersionCheck {
  const checks: NodeVersionCheck = { ok: true }

  const pVersion = process.version
  const pVersionC = semver.clean(pVersion)
  const LOWER_BOUND = 'v24.0.0'

  // pVersionC is null if the version string is invalid
  if (!pVersionC) {
    checks.ok = false
    checks.message = `Invalid Node.js version: ${pVersion}`

    return checks
  }

  if (semver.gte(pVersionC, LOWER_BOUND)) {
    return checks
  }

  checks.ok = false
  checks.message = [
    `Your Node.js version is ${c.warning(pVersion)}, but Cedar requires ` +
      `${c.important(`>= ${LOWER_BOUND}`)}.`,
    'Upgrade your Node.js version using `nvm`, `n`, or a similar tool. See ' +
      'https://cedarjs.com/docs/how-to/using-nvm.',
  ].join('\n')

  return checks
}
