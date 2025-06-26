import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Plugin as RollupPlugin } from 'rollup'

import { JS_EXT_RE } from '../utils'

const DIRNAME_VAR_NAME = '__injected_dirname__'
const FILENAME_VAR_NAME = '__injected_filename__'
const IMPORT_META_URL_VAR_NAME = '__injected_import_meta_url__'

export const injectFileGlobalsPlugin = (): RollupPlugin => {
  return {
    name: 'bundle-require:inject-file-globals',
    transform(code, id) {
      if (!JS_EXT_RE.test(id)) {
        return null
      }

      // Replace variables with injected versions in the transformed code
      const transformedCode = code
        .replace(/\b__filename\b/g, FILENAME_VAR_NAME)
        .replace(/\b__dirname\b/g, DIRNAME_VAR_NAME)
        .replace(/\bimport\.meta\.url\b/g, IMPORT_META_URL_VAR_NAME)

      const injectLines = [
        `const ${FILENAME_VAR_NAME} = ${JSON.stringify(id)};`,
        `const ${DIRNAME_VAR_NAME} = ${JSON.stringify(path.dirname(id))};`,
        `const ${IMPORT_META_URL_VAR_NAME} = ${JSON.stringify(
          pathToFileURL(id).href,
        )};`,
      ]

      return {
        code: injectLines.join('\n') + '\n' + transformedCode,
        // TODO: Generate a proper source map
        map: { mappings: '' },
      }
    },
  }
}
