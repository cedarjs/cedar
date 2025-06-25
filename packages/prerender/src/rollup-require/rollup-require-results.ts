import fs from 'node:fs'
import path from 'node:path'

import type { OutputOptions, RollupBuild } from 'rollup'

import type { Options } from './types'
import { guessFormat } from './utils'

export async function extractResult<T>(
  build: RollupBuild,
  options: Options,
  outDir: string,
) {
  const format = options.format ?? guessFormat(options.filepath)

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

    let code = chunk.code

    if (chunk.code.includes('__PRERENDER_CHUNK_ID.js')) {
      // const ContactContactPage = {
      //     name: "ContactContactPage",
      //     prerenderLoader: (name)=>require('./ContactPage-__PRERENDER_CHUNK_ID.js'),
      //     LazyComponent: /*#__PURE__*/ React.lazy(()=>Promise.resolve().then(function () { return require('./ContactPage-pvUUt2sr.js'); }))
      // };
      // const AboutPage = {
      //     name: "AboutPage",
      //     prerenderLoader: (name)=>require('./AboutPage-__PRERENDER_CHUNK_ID.js'),
      //     LazyComponent: /*#__PURE__*/ React.lazy(()=>Promise.resolve().then(function () { return require('./AboutPage-pvUUt2sr.js'); }))
      // };
      code = chunk.code.replace(
        /'\.\/([^']+Page-)__PRERENDER_CHUNK_ID\.js'/g,
        (_match, pageName) => {
          const chunkName = chunk.dynamicImports.find((importedChunk) =>
            importedChunk.startsWith(pageName),
          )
          return `'./${chunkName}'`
        },
      )
    }

    await fs.promises.writeFile(path.join(outDir, chunk.fileName), code, 'utf8')
  }

  let mod: T

  try {
    const outPath = path.join(outDir, output[0].fileName)

    mod = await import(outPath)
  } finally {
    if (!options.preserveTemporaryFile) {
      // Remove the output files after execution
      await fs.promises.rm(outDir, { recursive: true, force: true })
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
