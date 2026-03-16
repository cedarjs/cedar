import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { default as RSDWClientModule } from 'react-server-dom-webpack/client.edge'
import type { default as RSDWServerModule } from 'react-server-dom-webpack/server.edge'

import { getPaths } from '@cedarjs/project-config'

type RSDWClientType = typeof RSDWClientModule
type RSDWServerType = typeof RSDWServerModule

export function makeFilePath(path: string) {
  return pathToFileURL(path).href
}

/**
 * See vite/streamHelpers.ts.
 *
 * This function ensures we load the same version of rsdw_client to prevent multiple instances of React
 */
export async function importReact() {
<<<<<<< HEAD
=======
  if (globalThis.__cedarjs__vite_ssr_runtime) {
    const reactMod = await import('react')
    return reactMod.default
  }

>>>>>>> f47b2d976b (chore(rsc): rwjs -> cedarjs (#1378))
  const distSsr = getPaths().web.distSsr
  const reactPath = makeFilePath(path.join(distSsr, '__rwjs__react.mjs'))

  return (await import(reactPath)).default
}

/**
 * See vite/streamHelpers.ts.
 *
 * This function ensures we load the same version of rsdw_client to prevent multiple instances of React
 */
export async function importRsdwClient(): Promise<RSDWClientType> {
<<<<<<< HEAD
=======
  if (globalThis.__cedarjs__vite_ssr_runtime) {
    const rsdwcMod = await import('react-server-dom-webpack/client.edge')
    return rsdwcMod.default
  }

>>>>>>> f47b2d976b (chore(rsc): rwjs -> cedarjs (#1378))
  const distSsr = getPaths().web.distSsr
  const rsdwClientPath = makeFilePath(
    path.join(distSsr, '__rwjs__rsdw-client.mjs'),
  )

  return (await import(rsdwClientPath)).default
}

export async function importRsdwServer(): Promise<RSDWServerType> {
<<<<<<< HEAD
  // We need to do this weird import dance because we need to import a version
  // of react-server-dom-webpack/server.edge that has been built with the
  // `react-server` condition. If we just did a regular import, we'd get the
  // generic version in node_modules, and it'd throw an error about not being
  // run in an environment with the `react-server` condition.
  const dynamicImport = ''
  return import(
    /* @vite-ignore */
    dynamicImport + 'react-server-dom-webpack/server.edge'
  )
=======
  if (globalThis.__cedarjs__vite_rsc_runtime) {
    const rsdwServerMod =
      await globalThis.__cedarjs__vite_rsc_runtime.executeUrl(
        'react-server-dom-webpack/server.edge',
      )

    return rsdwServerMod.default
  } else {
    // We need to do this weird import dance because we need to import a version
    // of react-server-dom-webpack/server.edge that has been built with the
    // `react-server` condition. If we just did a regular import, we'd get the
    // generic version in node_modules, and it'd throw an error about not being
    // run in an environment with the `react-server` condition.
    const dynamicImport = ''
    return import(
      /* @vite-ignore */
      dynamicImport + 'react-server-dom-webpack/server.edge'
    )
  }
>>>>>>> f47b2d976b (chore(rsc): rwjs -> cedarjs (#1378))
}
