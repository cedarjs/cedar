import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { OutputOptions, RollupBuild } from 'rollup'

import type { Options } from './types'
import { dynamicImport, getRandomId, guessFormat, JS_EXT_RE } from './utils'

export async function extractResult(build: RollupBuild, options: Options) {
  const format = options.format ?? guessFormat(options.filepath)
  const outfile = getOutputFile(options.filepath, format)

  const outputOptions: OutputOptions = {
    file: outfile,
    format: format === 'esm' ? 'es' : 'cjs',
    exports: 'auto',
    sourcemap: 'inline',
  }

  const { output } = await build.generate(outputOptions)
  const chunk = output[0]

  if (chunk.type !== 'chunk') {
    throw new Error('[bundle-require] Expected chunk output')
  }

  await fs.promises.writeFile(outfile, chunk.code, 'utf8')

  let mod: any

  try {
    mod = await dynamicImport(
      format === 'esm' ? pathToFileURL(outfile).href : outfile,
      { format },
    )
  } finally {
    const preserveTemporaryFile =
      options.preserveTemporaryFile ?? !!process.env.BUNDLE_REQUIRE_PRESERVE

    if (!preserveTemporaryFile) {
      // Remove the outfile after executed
      await fs.promises.unlink(outfile)
    }
  }

  const cwd = options.cwd || process.cwd()
  const dependencies = Object.keys(chunk.modules || {}).map((dep) =>
    path.relative(cwd, dep),
  )

  return {
    mod,
    dependencies,
  }
}

// Use a random path to avoid import cache
function getOutputFile(filepath: string, format: 'esm' | 'cjs') {
  return filepath.replace(
    JS_EXT_RE,
    `.bundled_${getRandomId()}.${format === 'esm' ? 'mjs' : 'cjs'}`,
  )
}
