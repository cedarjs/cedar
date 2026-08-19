import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

import { getPaths } from '@cedarjs/project-config'

export function cedarEntryInjectionPlugin(): Plugin {
  const cedarPaths = getPaths()

  const clientEntryPath = cedarPaths.web.entryClient

  if (!clientEntryPath) {
    throw new Error(
      'Vite client entry point not found. Please check that your project has ' +
        'an entry.client.{jsx,tsx} file in the web/src directory.',
    )
  }

  const relativeEntryPath = normalizePath(
    path.relative(cedarPaths.web.base, clientEntryPath),
  )

  return {
    name: 'cedar-entry-injection',

    // Vite's dependency optimizer and dev server resolve the script tag
    // src="/src/entry.client.{tsx,jsx}" as an absolute filesystem path
    // (/src/entry.client.tsx) instead of relative to the Vite root.
    // This hook maps it to the real file path so Vite can find it.
    resolveId(id) {
      if (id === '/' + relativeEntryPath) {
        return clientEntryPath
      }

      return null
    },

    // ---------- Bundle injection ----------
    // Used by Vite during dev, to inject the entrypoint.
    transformIndexHtml: {
      order: 'pre',
      handler: (html: string, ctx) => {
        // Only inject for the project's own index.html, not for other
        // consumers of this plugin (e.g. Storybook). If ctx.filename is
        // not set or doesn't match Cedar's index.html, skip injection.
        if (
          !ctx.filename ||
          normalizePath(ctx.filename) !== normalizePath(cedarPaths.web.html)
        ) {
          return html
        }

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
        normalizePath(id) === normalizePath(cedarPaths.web.html)
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
