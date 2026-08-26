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

const overlaysPath = fileURLToPath(
  new URL('../templates/overlays', import.meta.url),
)

// Generate lockfiles for all three package managers and store them in the
// PM-specific overlay dir. The overlays are used by both the ts and js
// templates. We use the ts template as the representative base because it
// contains the same workspace member package.json files as js.
const generatedFiles = [
  await generateYarnLockfile(tsTemplatePath, path.join(overlaysPath, 'yarn')),
  await generateNpmLockfile(tsTemplatePath, path.join(overlaysPath, 'npm')),
  await generatePnpmLockfile(tsTemplatePath, path.join(overlaysPath, 'pnpm')),
]

await $`yarn pack -o create-cedar-app.tgz`

// Clean up the lockfiles we generated into the overlay dirs so they are not
// committed to source control. They are included in the tarball above.
for (const filePath of generatedFiles) {
  fs.rmSync(filePath, { force: true })
}
