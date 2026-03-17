import {
  ensurePosixPath,
  getPaths,
  importStatementPath,
} from '@cedarjs/project-config'
import { getProject } from '@cedarjs/structure/dist/index.js'
import type { RWPage } from '@cedarjs/structure/dist/model/RWPage.js'
import type { RWRoute } from '@cedarjs/structure/dist/model/RWRoute.js'

import { makeFilePath } from '../utils.js'

export function getEntries() {
  const entries: Record<string, string> = {}

  // Build the entries object based on routes and pages
  // Given the page's route, we can determine whether or not
  // the entry requires authentication checks
  const routes = getProject().getRouter().routes

  // Add the various pages
  const pages = routes.map((route: RWRoute) => route.page) as RWPage[]

  for (const page of pages) {
    entries[page.constName] = ensurePosixPath(importStatementPath(page.path))
  }

  // Add the ServerEntry entry, noting we use the "__cedarjs__" prefix to avoid
  // any potential conflicts with user-defined entries
  const serverEntry = getPaths().web.entryServer
  if (!serverEntry) {
    throw new Error('Server Entry file not found')
  }
  entries['__cedarjs__ServerEntry'] = serverEntry
  entries['__cedarjs__Routes'] = getPaths().web.routes

  return entries
}

export async function getEntriesFromDist(): Promise<Record<string, string>> {
  const entriesDist = getPaths().web.distRscEntries
  const { serverEntries } = await import(makeFilePath(entriesDist))
  return serverEntries
}
