import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cd, within, $ } from 'zx'

const tsTemplatePath = fileURLToPath(
  new URL('../templates/ts', import.meta.url),
)

const esmTsTemplatePath = fileURLToPath(
  new URL('../templates/esm-ts', import.meta.url),
)

const overlaysPath = fileURLToPath(
  new URL('../templates/overlays', import.meta.url),
)

async function generateLockfile(
  templatePath,
  overlayDir,
  lockfileName,
  packageManager,
  packageManagerArgs = [],
) {
  console.log(`Generating ${lockfileName}...`)
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `cedar-${packageManager}-`),
  )

  try {
    fs.cpSync(templatePath, tmpDir, { recursive: true })
    fs.cpSync(overlayDir, tmpDir, { recursive: true, force: true })

    await within(async () => {
      cd(tmpDir)

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

// For each (baseTemplate, overlayBase) pair we generate lockfiles for all
// three package managers and store them in the PM-specific overlay dir.
// The cjs overlays are used by both the ts and js templates.
// The esm overlays are used by both the esm-ts and esm-js templates.
// We use the ts / esm-ts templates as the representative base because they
// contain the same workspace member package.json files as js / esm-js.
const configs = [
  { templatePath: tsTemplatePath, overlayBase: 'cjs' },
  { templatePath: esmTsTemplatePath, overlayBase: 'esm' },
]

const generatedFiles = []

for (const { templatePath, overlayBase } of configs) {
  const overlaysBaseDir = path.join(overlaysPath, overlayBase)

  const yarnLock = await generateLockfile(
    templatePath,
    path.join(overlaysBaseDir, 'yarn'),
    'yarn.lock',
    'yarn',
  )

  const npmLock = await generateLockfile(
    templatePath,
    path.join(overlaysBaseDir, 'npm'),
    'package-lock.json',
    'npm',
    // TODO(PM): remove the `--force` and `--loglevel` flags when we're shipping
    // React 19
    ['install', '--force', '--loglevel', 'error'],
  )

  const pnpmLock = await generateLockfile(
    templatePath,
    path.join(overlaysBaseDir, 'pnpm'),
    'pnpm-lock.yaml',
    'pnpm',
    ['install'],
  )

  generatedFiles.push(yarnLock, npmLock, pnpmLock)
}

await $`yarn pack -o create-cedar-app.tgz`

// Clean up the lockfiles we generated into the overlay dirs so they are not
// committed to source control. They are included in the tarball above.
for (const filePath of generatedFiles) {
  fs.rmSync(filePath, { force: true })
}
