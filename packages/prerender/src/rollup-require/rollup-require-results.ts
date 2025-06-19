import fs from 'node:fs'
import path from 'node:path'

import type { OutputOptions, RollupBuild } from 'rollup'

import type { Options } from './types'
import { guessFormat, JS_EXT_RE } from './utils'

export async function extractResult(build: RollupBuild, options: Options) {
  const format = options.format ?? guessFormat(options.filepath)
  const getOutputFileFn = options.getOutputFile ?? defaultGetOutputFile
  const timestamp = Date.now().toString()

  const outDir = options.cwd ?? process.cwd()

  const outputOptions: OutputOptions = {
    dir: outDir,
    format: format === 'esm' ? 'es' : 'cjs',
    exports: 'auto',
    sourcemap: 'inline',
  }

  const { output } = await build.generate(outputOptions)

  for (const chunk of output) {
    if (chunk.type !== 'chunk') {
      throw new Error('[bundle-require] Expected chunk output')
    }

    const outPath = path.join(
      outDir,
      getOutputFileFn(chunk.fileName, format, timestamp),
    )

    await fs.promises.writeFile(outPath, chunk.code, 'utf8')
  }

  let mod: any

  try {
    const outPath = path.join(
      outDir,
      getOutputFileFn(output[0].fileName, format, timestamp),
    )

    mod = await import(outPath)
  } finally {
    if (!options.preserveTemporaryFile) {
      // Remove the output files after execution
      for (const chunk of output) {
        if (chunk.type !== 'chunk') {
          continue
        }

        const outPath = path.join(
          outDir,
          getOutputFileFn(chunk.fileName, format, timestamp),
        )

        await fs.promises.unlink(outPath)
      }
    }
  }

  const dependencies = output.flatMap((chunk) =>
    Object.keys(chunk.type === 'chunk' ? chunk.modules || {} : {}).map((dep) =>
      path.relative(outDir, dep),
    ),
  )

  return {
    mod,
    dependencies,
  }
}

// Use a random path to avoid import cache
function defaultGetOutputFile(
  filepath: string,
  format: 'esm' | 'cjs',
  randomId: string,
) {
  return filepath.replace(
    JS_EXT_RE,
    `.bundled_${randomId}.${format === 'esm' ? 'mjs' : 'cjs'}`,
  )
}
