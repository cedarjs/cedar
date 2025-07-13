import type { Plugin } from 'vite'

import { getConfig } from '@cedarjs/project-config'

export function cedarHtmlEnvPlugin() {
  return {
    name: 'cedar-html-env',

    // Vite can support replacing environment variables in index.html but
    // there are currently two issues with that:
    // 1. It requires the environment variables to be exposed on
    //    `import.meta.env`, but we expose them on `process.env` in Redwood.
    // 2. There's an open issue on Vite where it adds extra quotes around
    //    the replaced values, which breaks trying to use environment
    //    variables in src attributes for example.
    // Until those issues are resolved, we'll do the replacement ourselves
    // instead using transformIndexHtml. Doing it this was was also the
    // recommended way until Vite added built-in support for it.
    //
    // Extra quotes issue: https://github.com/vitejs/vite/issues/13424
    // transformIndexHtml being the recommended way:
    //   https://github.com/vitejs/vite/issues/3105#issuecomment-1059975023
    transformIndexHtml: {
      // Setting order: 'pre' so that it runs before the built-in
      // html env replacement.
      order: 'pre',
      handler: (html: string) => {
        let newHtml = html

        getConfig().web.includeEnvironmentVariables.map((envName) => {
          newHtml = newHtml.replaceAll(
            `%${envName}%`,
            process.env[envName] || '',
          )
        })

        Object.entries(process.env).forEach(([envName, value]) => {
          if (envName.startsWith('REDWOOD_ENV_')) {
            newHtml = newHtml.replaceAll(`%${envName}%`, value || '')
          }
        })

        return newHtml
      },
    },
  } satisfies Plugin
}
