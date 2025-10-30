import semver from 'semver'

import c from '../lib/colors.js'

export function checkNodeVersion() {
  const checks = { ok: true }

  const pVersion = process.version
  const pVersionC = semver.clean(pVersion)
  const LOWER_BOUND = 'v24.0.0'

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
