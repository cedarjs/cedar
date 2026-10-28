import fs from 'node:fs'
import path from 'node:path'

import type { PluginOption } from 'vite'

import { getPaths } from '@cedarjs/project-config'

const MODULE_ID = '~__CEDAR__ORG_CLIENTS_FOR_MOCK'
const RESOLVED_MODULE_ID = '\0' + MODULE_ID

/** Whether `webBase`'s package.json depends on `@cedarjs/tenancy` (`cedar setup tenancy` adds it) */
function webHasTenancy(webBase: string) {
  try {
    const packageJson: unknown = JSON.parse(
      fs.readFileSync(path.join(webBase, 'package.json'), 'utf-8'),
    )

    if (!packageJson || typeof packageJson !== 'object') {
      return false
    }

    return ['dependencies', 'devDependencies'].some((field) => {
      const deps: unknown = Reflect.get(packageJson, field)

      return !!deps && typeof deps === 'object' && '@cedarjs/tenancy' in deps
    })
  } catch {
    return false
  }
}

/** The source of the virtual module for the web side at `webBase` */
export function orgClientsModuleSource(webBase: string) {
  return webHasTenancy(webBase)
    ? "export { clearOrgClients } from '@cedarjs/tenancy/web'"
    : 'export const clearOrgClients = async () => {}'
}

/**
 * `clearOrgClients` from the app's `@cedarjs/tenancy/web`, so the
 * `StorybookProvider` can clear the per-organization Apollo clients before
 * each story. In an app without tenancy it does nothing.
 */
export function mockOrgClients(): PluginOption {
  return {
    name: 'mock-org-clients',
    resolveId(id: string) {
      return id === MODULE_ID ? RESOLVED_MODULE_ID : null
    },
    load(id: string) {
      if (id !== RESOLVED_MODULE_ID) {
        return null
      }

      return orgClientsModuleSource(getPaths().web.base)
    },
  }
}
