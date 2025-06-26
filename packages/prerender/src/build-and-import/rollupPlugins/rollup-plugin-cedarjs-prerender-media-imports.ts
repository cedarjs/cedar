import { extname, join, relative, dirname } from 'node:path'

import type { Plugin } from 'rollup'

import { ensurePosixPath, getPaths } from '@cedarjs/project-config'

import { convertToDataUrl } from './utils'

// This list of extensions matches config for file-loader
const defaultExtensions = [
  '.ico',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.svg',
  '.eot',
  '.otf',
  '.webp',
  '.ttf',
  '.woff',
  '.woff2',
  '.cur',
  '.ani',
  '.pdf',
  '.bmp',
]

type ViteManifestChunk = { file: string }
type ViteManifest = Record<string, ViteManifestChunk>

export interface PrerenderMediaImportsOptions {
  extensions?: string[]
}

/**
 * A Rollup plugin that transforms media imports during prerendering.
 *
 * This plugin processes imports of media files (images, fonts, etc.) and either:
 * 1. Replaces them with the built asset path from the Vite manifest, or
 * 2. Converts them to base64 data URLs if not found in the manifest
 *
 * # Example transformation
 *
 * ```javascript
 * // Before
 * import logo from './logo.png'
 *
 * // After (if in manifest)
 * const logo = 'assets/logo-abc123.png'
 *
 * // After (if not in manifest)
 * const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...'
 */
export function cedarjsPrerenderMediaImportsPlugin(
  options: PrerenderMediaImportsOptions = {},
): Plugin {
  const extensions = options.extensions || defaultExtensions
  let buildManifest: ViteManifest | null = null

  return {
    name: 'cedarjs-prerender-media-imports',
    buildStart() {
      try {
        const manifestPath = join(
          getPaths().web.dist,
          'client-build-manifest.json',
        )
        delete require.cache[require.resolve(manifestPath)]
        buildManifest = require(manifestPath)
      } catch {
        // Manifest not found, all imports will fallback to data URLs
        buildManifest = {}
      }
    },
    resolveId(source, _importer) {
      const ext = extname(source)
      if (!ext || !extensions.includes(ext)) {
        return null
      }

      // This is a media import, we'll handle it
      return {
        id: source,
        external: false,
      }
    },
    load(id) {
      const ext = extname(id)
      if (!ext || !extensions.includes(ext)) {
        return null
      }

      // Calculate the absolute path and manifest key
      const importerModule = Array.from(this.getModuleIds()).find(
        (moduleId) => {
          const moduleInfo = this.getModuleInfo(moduleId)
          return moduleInfo?.importedIds?.includes(id)
        },
      )

      let absPath: string
      let viteManifestKey: string

      if (importerModule && importerModule !== 'entry.js') {
        // Real module - calculate relative to importer
        const importerDir = dirname(importerModule)
        absPath = join(importerDir, id)
        viteManifestKey = ensurePosixPath(relative(getPaths().web.src, absPath))
      } else {
        // Virtual/test module - treat import as relative to web src root
        const normalizedId = id.startsWith('./') ? id.slice(2) : id
        absPath = join(getPaths().web.src, normalizedId)
        viteManifestKey = ensurePosixPath(normalizedId)
      }

      // Check if the asset is in the manifest
      const copiedAssetPath = buildManifest?.[viteManifestKey]?.file

      let assetSrc: string
      if (copiedAssetPath) {
        assetSrc = copiedAssetPath
      } else {
        // Convert to data URL
        assetSrc = convertToDataUrl(absPath)
      }

      // Return the asset source as an ES module default export
      return `export default ${JSON.stringify(assetSrc)};`
    },
  }
}
