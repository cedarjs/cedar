import execa from 'execa'

/**
 * This function will run `yarn build:types` to generate the ESM type
 * definitions.
 */
export async function generateTypesEsm() {
  try {
    await execa('yarn', ['build:types'], { stdio: 'inherit' })
  } catch (e) {
    console.error('---- Error building ESM types ----')
    process.exitCode = getExitCode(e) ?? 1
    throw e
  }
}

function getExitCode(e: unknown): number | undefined {
  if (typeof e === 'object' && e !== null && 'exitCode' in e) {
    const exitCode = e.exitCode

    if (typeof exitCode === 'number') {
      return exitCode
    }
  }

  return undefined
}
