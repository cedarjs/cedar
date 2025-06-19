import fs from 'node:fs'
import path from 'node:path'

import type { OutputOptions, RollupBuild } from 'rollup'

import type { Options } from './types'
import { guessFormat, JS_EXT_RE } from './utils'

export async function extractResult(build: RollupBuild, options: Options) {
  const format = options.format ?? guessFormat(options.filepath)
  const outfile = options.getOutputFile
    ? options.getOutputFile(options.filepath, format)
    : defaultGetOutputFile(options.filepath, format, Date.now().toString())

  console.log('dirname', path.dirname(outfile))
  console.log('basename', path.basename(outfile))
  const outDir = options.cwd ?? process.cwd()
  console.log('outDir', outDir)

  if (!outDir) {
    throw new Error('[rollup-require] Failed to create output directory')
  }

  const outputOptions: OutputOptions = {
    // file: outfile,
    dir: outDir,
    format: format === 'esm' ? 'es' : 'cjs',
    exports: 'auto',
    sourcemap: 'inline',
  }

  const { output } = await build.generate(outputOptions)

  const timestamp = Date.now().toString()

  console.log('output', output)

  for (const chunk of output) {
    if (chunk.type !== 'chunk') {
      throw new Error('[bundle-require] Expected chunk output')
    }

    const outPath = path.join(
      outDir,
      defaultGetOutputFile(chunk.fileName, 'cjs', timestamp),
    )
    console.log('writing to', outPath)

    await fs.promises.writeFile(outPath, chunk.code, 'utf8')
  }

  let mod: any

  try {
    const outPath = path.join(
      outDir,
      defaultGetOutputFile(output[0].fileName, 'cjs', timestamp),
    )
    console.log('importing', outPath)
    // mod = await dynamicImport(
    //   format === 'esm' ? pathToFileURL(outPath).href : outPath,
    //   { format },
    // )
    mod = await import(outPath)
  } finally {
    const preserveTemporaryFile =
      options.preserveTemporaryFile ?? !!process.env.BUNDLE_REQUIRE_PRESERVE

    if (!preserveTemporaryFile && Math.random() > 5) {
      // Remove the outfile after executed
      await fs.promises.unlink(outfile)
    }
  }

  const cwd = options.cwd || process.cwd()
  console.log('cwd', cwd)
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
  id: string,
) {
  return filepath.replace(
    JS_EXT_RE,
    `.bundled_${id}.${format === 'esm' ? 'mjs' : 'cjs'}`,
  )
}
