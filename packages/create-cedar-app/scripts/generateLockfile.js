import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { cd, within, $ } from 'zx'

// Entries that must never leak from the base template into the composed
// project: install artifacts and lockfiles from other package managers would
// influence (or end up next to) the lockfile we're generating
const EXCLUDED_TEMPLATE_ENTRIES = [
  'node_modules',
  '.yarn',
  'yarn.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
]

/**
 * Composes a base template and a package-manager overlay in a temp dir, runs
 * an install there, and copies the resulting lockfile into the overlay dir.
 *
 * The overlays replace the base template's root package.json wholesale, so
 * lockfiles have to be generated against the base template + overlay
 * composition rather than the base template alone.
 *
 * Returns the path to the generated lockfile.
 */
export async function generateLockfile(
  templatePath,
  overlayDir,
  lockfileName,
  packageManager,
  packageManagerArgs = [],
  env = {},
) {
  console.log(`Generating ${lockfileName}...`)
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `cedar-${packageManager}-`),
  )

  try {
    fs.cpSync(templatePath, tmpDir, {
      recursive: true,
      filter: (src) => !EXCLUDED_TEMPLATE_ENTRIES.includes(path.basename(src)),
    })
    fs.cpSync(overlayDir, tmpDir, { recursive: true, force: true })

    await within(async () => {
      cd(tmpDir)
      $.env = { ...process.env, ...env }

      await $`touch ${lockfileName}`
      console.log(`Installing dependencies using ${packageManager}...`)
      await $`${packageManager} ${packageManagerArgs}`
    })

    const lockDest = path.join(overlayDir, lockfileName)
    fs.copyFileSync(path.join(tmpDir, lockfileName), lockDest)

    return lockDest
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

export function generateYarnLockfile(templatePath, overlayDir) {
  // Yarn defaults to immutable installs on CI, which would refuse to write
  // the lockfile we're generating here
  return generateLockfile(templatePath, overlayDir, 'yarn.lock', 'yarn', [], {
    YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
  })
}

export function generateNpmLockfile(templatePath, overlayDir) {
  // TODO(PM): remove the `--force` and `--loglevel` flags when we're shipping
  // React 19
  return generateLockfile(
    templatePath,
    overlayDir,
    'package-lock.json',
    'npm',
    ['install', '--no-audit', '--no-fund', '--force', '--loglevel', 'error'],
  )
}

export function generatePnpmLockfile(templatePath, overlayDir) {
  return generateLockfile(templatePath, overlayDir, 'pnpm-lock.yaml', 'pnpm', [
    'install',
  ])
}
