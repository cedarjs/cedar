import type { Plugin as RollupPlugin } from 'rollup'

/**
 * A Rollup plugin that ignores imports of HTML and CSS files by replacing them with empty modules.
 * This is useful when bundling code that imports these files for webpack or other bundlers,
 * but you want Rollup to ignore them during the build process.
 *
 * @param options Configuration options
 * @returns Rollup plugin
 *
 * @example
 * ```js
 * import { ignoreHtmlAndCssImportsPlugin } from './rollup-plugin-ignore-html-and-css-imports'
 *
 * export default {
 *   plugins: [
 *     ignoreHtmlAndCssImportsPlugin({
 *       removeExtensions: ['.html', '.css', '.scss', '.sass']
 *     })
 *   ]
 * }
 * ```
 */
export const ignoreHtmlAndCssImportsPlugin = (): RollupPlugin => {
  const fileTypes = ['.html', '.scss', '.css']

  return {
    name: 'ignore-html-and-css-imports',
    resolveId(id) {
      if (fileTypes.some((ext) => id.endsWith(ext))) {
        // Return a virtual module that exports nothing
        return {
          id: `\0virtual:ignore-${id}`,
          external: false,
        }
      }

      return null
    },
    load(id) {
      if (id.startsWith('\0virtual:ignore-')) {
        // Return an empty module for ignored imports
        return 'export default {};'
      }

      return null
    },
  }
}
