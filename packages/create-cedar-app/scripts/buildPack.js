/* eslint-env node */

import { fileURLToPath } from 'node:url'

import { cd, path, within, $ } from 'zx'

const tsTemplatePath = fileURLToPath(
  new URL('../templates/ts', import.meta.url),
)
const jsTemplatePath = fileURLToPath(
  new URL('../templates/js', import.meta.url),
)

// We're running `yarn` here inside the template directories to generate
// lockfiles. The lockfiles are then included in the packed tarball by
// `yarn pack`. The point of this is to speed up installation in the user's
// project. Installation is faster because lockfiles saves yarn from having to
// do dependency resolution.

await within(async () => {
  cd(tsTemplatePath)

  await $`touch yarn.lock`
  await $`yarn`
})

await within(async () => {
  cd(jsTemplatePath)

  await $`touch yarn.lock`
  await $`yarn`
})

await $`yarn pack -o create-cedar-app.tgz`

await $`rm ${path.join(tsTemplatePath, 'yarn.lock')}`
await $`rm ${path.join(jsTemplatePath, 'yarn.lock')}`
await $`rm -rf ${path.join(tsTemplatePath, 'node_modules')}`
await $`rm -rf ${path.join(jsTemplatePath, 'node_modules')}`
