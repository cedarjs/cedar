import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

import { getPaths } from '@cedarjs/project-config'

export function cedarEntryInjectionPlugin(): Plugin {
  const rwPaths = getPaths()

  const clientEntryPath = rwPaths.web.entryClient

  if (!clientEntryPath) {
    throw new Error(
      'Vite client entry point not found. Please check that your project has ' +
        'an entry.client.{jsx,tsx} file in the web/src directory.',
    )
  }

  const relativeEntryPath = path.relative(rwPaths.web.src, clientEntryPath)

  return {
    name: 'cedar-entry-injection',

    // ---------- Bundle injection ----------
    // Used by Vite during dev, to inject the entrypoint.
    transformIndexHtml: {
      order: 'pre',
      handler: (html: string) => {
        // So we inject the entrypoint with the correct extension .tsx vs .jsx

        // And then inject the entry
        if (fs.existsSync(clientEntryPath)) {
          return html.replace(
            '</head>',
            // @NOTE the slash in front, for windows compatibility and for
            // pages in subdirectories
            `<script type="module" src="/${relativeEntryPath}"></script>
      </head>`,
          )
        } else {
          return html
        }
      },
    },
    // Used by rollup during build to inject the entrypoint
    // but note index.html does not come through as an id during dev
    transform: (code: string, id: string) => {
      if (
        fs.existsSync(clientEntryPath) &&
        normalizePath(id) === normalizePath(rwPaths.web.html)
      ) {
        return {
          code: code.replace(
            '</head>',
            `<script type="module" src="/${relativeEntryPath}"></script>
      </head>`,
          ),
          map: null,
        }
      } else {
        return {
          code,
          map: null, // Returning null here preserves the original sourcemap
        }
      }
    },
  }
}
