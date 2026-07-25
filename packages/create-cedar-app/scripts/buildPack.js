import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { $ } from 'zx'

import {
  generateNpmLockfile,
  generatePnpmLockfile,
  generateYarnLockfile,
} from './generateLockfile.js'

const tsTemplatePath = fileURLToPath(
  new URL('../templates/ts', import.meta.url),
)

const esmTsTemplatePath = fileURLToPath(
  new URL('../templates/esm-ts', import.meta.url),
)

const overlaysPath = fileURLToPath(
  new URL('../templates/overlays', import.meta.url),
)

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

  const yarnLock = await generateYarnLockfile(
    templatePath,
    path.join(overlaysBaseDir, 'yarn'),
  )

  const npmLock = await generateNpmLockfile(
    templatePath,
    path.join(overlaysBaseDir, 'npm'),
  )

  const pnpmLock = await generatePnpmLockfile(
    templatePath,
    path.join(overlaysBaseDir, 'pnpm'),
  )

  generatedFiles.push(yarnLock, npmLock, pnpmLock)
}

await $`yarn pack -o create-cedar-app.tgz`

// Clean up the lockfiles we generated into the overlay dirs so they are not
// committed to source control. They are included in the tarball above.
for (const filePath of generatedFiles) {
  fs.rmSync(filePath, { force: true })
}
