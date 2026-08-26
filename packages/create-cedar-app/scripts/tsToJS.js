/* eslint-env node */

// Derives `templates/js` from `templates/ts`. The output is committed, and CI
// (`.github/workflows/check-create-cedar-app.yml`) reruns this script and
// fails if the committed JS template differs from what the script produces.

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { format } from 'prettier'
import { glob, path } from 'zx'

import { transpileTSToJS } from '@cedarjs/cli-helpers'

const TS_TEMPLATE_PATH = fileURLToPath(
  new URL('../templates/ts', import.meta.url),
)
const JS_TEMPLATE_PATH = fileURLToPath(
  new URL('../templates/js', import.meta.url),
)

const { default: prettierConfig } = await import(
  new URL('../templates/ts/prettier.config.cjs', import.meta.url)
)

await removeInstallArtifactsFromTsTemplate()
await replaceJsTemplateWithCopyOfTsTemplate()
await transpileSourceFiles()
await convertTsConfigsToJsConfigs()
await rewriteTsFileReferences()
await updateAuthLintIgnoreLine()
await removeCellTypeAnnotationsEslintOverride()

/**
 * Removes `node_modules` and yarn's `install-state.gz` from the TS template
 * so they are not copied into the JS template.
 */
async function removeInstallArtifactsFromTsTemplate() {
  console.log('Removing `node_modules` in the TS template')
  await fs.promises.rm(path.join(TS_TEMPLATE_PATH, 'node_modules'), {
    recursive: true,
    force: true,
  })

  console.log("Removing yarn's `install-state.gz` in the TS template")
  await fs.promises.rm(
    path.join(TS_TEMPLATE_PATH, '.yarn', 'install-state.gz'),
    { force: true },
  )
}

/** Deletes the JS template and replaces it with a copy of the TS template. */
async function replaceJsTemplateWithCopyOfTsTemplate() {
  console.log('Removing the JS template')
  await fs.promises.rm(JS_TEMPLATE_PATH, { recursive: true, force: true })

  console.log('Copying the TS template to the JS template')
  await fs.promises.cp(TS_TEMPLATE_PATH, JS_TEMPLATE_PATH, { recursive: true })
}

/**
 * Transpiles every `.ts`/`.tsx` file (including root-level config files) to
 * `.js`/`.jsx` and formats the result with the template's prettier config.
 * The root `vitest.config.ts` becomes `vitest.config.mjs`, matching the
 * extension the JS template ships.
 */
async function transpileSourceFiles() {
  console.group('Transforming files in the JS template')

  const filePaths = await glob(['*.ts', '{api,web,scripts}/**/*.{ts,tsx}'], {
    cwd: JS_TEMPLATE_PATH,
    absolute: true,
  })

  for (const filePath of filePaths) {
    console.log(`• ${filePath}`)

    const source = await fs.promises.readFile(filePath, 'utf-8')
    const code = transpileTSToJS(filePath, source)
    const formattedCode = await format(code, {
      ...prettierConfig,
      parser: 'babel',
    })

    await fs.promises.writeFile(toJsFilePath(filePath), formattedCode, 'utf-8')
    await fs.promises.rm(filePath)
  }

  console.groupEnd()
}

/** Maps a TS file path in the JS template to its JS counterpart. */
function toJsFilePath(filePath) {
  if (path.dirname(filePath) === JS_TEMPLATE_PATH) {
    return filePath.replace(/\.ts$/, '.mjs')
  }

  return filePath.replace(/\.tsx$/, '.jsx').replace(/\.ts$/, '.js')
}

/**
 * Renames every `tsconfig.json` to `jsconfig.json` and drops the compiler
 * options that only apply to TS files.
 */
async function convertTsConfigsToJsConfigs() {
  console.group(
    'Transforming `tsconfig.json`s in the JS template to `jsconfig.json`s',
  )

  const tsConfigFilePaths = await glob(['{api,web,scripts}/**/tsconfig.json'], {
    cwd: JS_TEMPLATE_PATH,
    absolute: true,
  })

  for (const tsConfigFilePath of tsConfigFilePaths) {
    console.log(`• ${tsConfigFilePath}`)

    const jsConfigFilePath = path.join(
      path.dirname(tsConfigFilePath),
      'jsconfig.json',
    )

    await fs.promises.rename(tsConfigFilePath, jsConfigFilePath)

    const jsConfig = JSON.parse(
      await fs.promises.readFile(jsConfigFilePath, 'utf-8'),
    )

    // A JS project has no `.ts` files to allow or import.
    delete jsConfig.compilerOptions.allowJs
    delete jsConfig.compilerOptions.allowImportingTsExtensions

    await fs.promises.writeFile(
      jsConfigFilePath,
      JSON.stringify(jsConfig, null, 2) + '\n',
    )
  }

  console.groupEnd()
}

/**
 * Config files and the seed script mention sibling files by name (for
 * example `setupFiles: ['./vitest.setup.ts']`). Those files have been
 * transpiled, so the references are updated to the `.js`/`.jsx` extensions.
 */
async function rewriteTsFileReferences() {
  console.group('Updating `.ts`/`.tsx` file references')

  const filePaths = await glob(
    [
      '*.mjs',
      '{api,web}/vite.config.js',
      '{api,web}/vitest.config.js',
      '{api,web}/vitest.setup.js',
      'scripts/seed.js',
    ],
    { cwd: JS_TEMPLATE_PATH, absolute: true },
  )

  for (const filePath of filePaths) {
    console.log(`• ${filePath}`)

    const source = await fs.promises.readFile(filePath, 'utf-8')
    // Matches path-like tokens ending in `.ts`/`.tsx`, such as
    // `./vitest.setup.ts` or `scripts/seed.ts`.
    const updated = source.replace(
      /([\w./-]+)\.ts(x?)\b/g,
      (_match, base, x) => `${base}.js${x}`,
    )

    await fs.promises.writeFile(filePath, updated, 'utf-8')
  }

  console.groupEnd()
}

/** `auth.js` is linted with the core rule, not the TS-ESLint one. */
async function updateAuthLintIgnoreLine() {
  console.group('Updating lint ignore line in auth.js')

  const authFilePath = path.join(
    JS_TEMPLATE_PATH,
    'api',
    'src',
    'lib',
    'auth.js',
  )
  const authFile = await fs.promises.readFile(authFilePath, 'utf-8')
  await fs.promises.writeFile(
    authFilePath,
    authFile.replace('@typescript-eslint/no-unused-vars', 'no-unused-vars'),
  )

  console.groupEnd()
}

/**
 * `cell-type-annotations` only matches `.tsx` Cells, so it can never fire in
 * a JS project. The override is dropped rather than shipping a dead rule
 * reference.
 */
async function removeCellTypeAnnotationsEslintOverride() {
  console.group(
    'Removing the cell-type-annotations override from eslint.config.js',
  )

  const eslintConfigFilePath = path.join(JS_TEMPLATE_PATH, 'eslint.config.js')
  const eslintConfigFile = await fs.promises.readFile(
    eslintConfigFilePath,
    'utf-8',
  )
  await fs.promises.writeFile(
    eslintConfigFilePath,
    eslintConfigFile.replace(
      `export default [
  ...(await cedarConfig()),
  {
    files: ['web/src/**/*Cell.tsx'],
    rules: {
      '@cedarjs/cell-type-annotations': 'error',
    },
  },
]
`,
      'export default await cedarConfig()\n',
    ),
  )

  console.groupEnd()
}
