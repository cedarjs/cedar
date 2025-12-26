import type { ResolveIdResult, TransformPluginContext } from 'rollup'

import { ignoreHtmlAndCssImportsPlugin } from '../rollup-plugin-cedarjs-ignore-html-and-css-imports.js'

describe('ignoreHtmlAndCssImportsPlugin', () => {
  describe('resolveId', () => {
    it('should ignore .html imports', () => {
      const plugin = ignoreHtmlAndCssImportsPlugin()
      const resolveId = plugin.resolveId

      if (typeof resolveId !== 'function') {
        throw new Error('Unexpected resolveId type')
      }

      const result = resolveId.call(
        {} as TransformPluginContext,
        './template.html',
        undefined,
        { attributes: {}, isEntry: false },
      ) as ResolveIdResult

      expect(result).toEqual({
        id: '\0virtual:ignore-./template.html',
        external: false,
      })
    })

    it('should ignore .css imports', () => {
      const plugin = ignoreHtmlAndCssImportsPlugin()
      const resolveId = plugin.resolveId

      if (typeof resolveId !== 'function') {
        throw new Error('Unexpected resolveId type')
      }

      const result = resolveId.call(
        {} as TransformPluginContext,
        './styles.css',
        undefined,
        { attributes: {}, isEntry: false },
      ) as ResolveIdResult

      expect(result).toEqual({
        id: '\0virtual:ignore-./styles.css',
        external: false,
      })
    })

    it('should ignore .scss imports', () => {
      const plugin = ignoreHtmlAndCssImportsPlugin()
      const resolveId = plugin.resolveId

      if (typeof resolveId !== 'function') {
        throw new Error('Unexpected resolveId type')
      }

      const result = resolveId.call(
        {} as TransformPluginContext,
        './styles.scss',
        undefined,
        { attributes: {}, isEntry: false },
      ) as ResolveIdResult

      expect(result).toEqual({
        id: '\0virtual:ignore-./styles.scss',
        external: false,
      })
    })

    it('should not ignore other file types', () => {
      const plugin = ignoreHtmlAndCssImportsPlugin()
      const resolveId = plugin.resolveId

      if (typeof resolveId !== 'function') {
        throw new Error('Unexpected resolveId type')
      }

      const result = resolveId.call(
        {} as TransformPluginContext,
        './module.js',
        undefined,
        { attributes: {}, isEntry: false },
      )

      expect(result).toBeNull()
    })
  })

  describe('load', () => {
    it('should return empty export for virtual ignore modules', () => {
      const plugin = ignoreHtmlAndCssImportsPlugin()
      const load = plugin.load

      if (typeof load !== 'function') {
        throw new Error('Unexpected load type')
      }

      const result = load.call(
        {} as TransformPluginContext,
        '\0virtual:ignore-./styles.css',
      )

      expect(result).toBe('export default {};')
    })

    it('should return null for non-virtual modules', () => {
      const plugin = ignoreHtmlAndCssImportsPlugin()
      const load = plugin.load

      if (typeof load !== 'function') {
        throw new Error('Unexpected load type')
      }

      const result = load.call({} as TransformPluginContext, './real-module.js')

      expect(result).toBeNull()
    })
  })
})
