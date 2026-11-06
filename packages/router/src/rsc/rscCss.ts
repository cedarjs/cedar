import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

// Note: The current implementation here simply aggregates all CSS but inspecting
// the manifest files produced during build. In the future we may wish to move to
// a technique that does not rely on build artifacts.
// We may also wish to look at more sophisticated techniques for selecting specific
// CSS files based on the component(s) being rendered rather than just aggregating
// all CSS. Previously we attempted to inject `preinit` calls into the components
// via a vite plugin but this was reverted due to issues with writing to closed
// streams - which was too difficult to resolve at that time.
export function getRscStylesheetLinkGenerator(existingLinks?: string[]) {
  const clientBuildManifestPath = path.join(
    getPaths().web.distBrowser,
    'client-build-manifest.json',
  )
  const clientBuildManifest = JSON.parse(
    fs.readFileSync(clientBuildManifestPath, 'utf-8'),
  )
  const clientCss = extractCssMappingFromManifest(clientBuildManifest)

  const serverBuildManifestPath = path.join(
    getPaths().web.distRsc,
    'server-build-manifest.json',
  )
  const serverBuildManifest = JSON.parse(
    fs.readFileSync(serverBuildManifestPath, 'utf-8'),
  )
  const serverCss = extractCssMappingFromManifest(serverBuildManifest)

  const allCss = new Set<string>()
  for (const cssList of clientCss.values()) {
    for (const css of cssList) {
      allCss.add(css)
    }
  }
  for (const cssList of serverCss.values()) {
    for (const css of cssList) {
      allCss.add(css)
    }
  }

  const cssLinks = Array.from(allCss)
  return () => [...(existingLinks || []), ...cssLinks]
}

export function extractCssMappingFromManifest(manifest: Record<string, any>) {
  const manifestCss = new Map<string, string[]>()
  const lookupCssAssets = (id: string): string[] => {
    const assets: string[] = []
    // Chunks can import each other circularly, so every chunk is visited at
    // most once per top-level lookup.
    const visited = new Set<string>()
    const visit = (chunkId: string) => {
      if (visited.has(chunkId)) {
        return
      }
      visited.add(chunkId)
      const asset = manifest[chunkId]
      if (!asset) {
        return
      }
      if (asset.css) {
        assets.push(...asset.css)
      }
      if (asset.imports) {
        for (const importId of asset.imports) {
          visit(importId)
        }
      }
    }
    visit(id)
    return assets
  }
  for (const key of Object.keys(manifest)) {
    manifestCss.set(key, lookupCssAssets(key))
  }
  return manifestCss
}
