import fs from 'node:fs'
import path from 'path'

import { fetch } from '@whatwg-node/fetch'

import { getPaths } from '@cedarjs/project-config'

/**
 * Fetches the FatalErrorPage from the create-cedar-app template and replaces
 * the current one in the project
 */
export const updateDevFatalErrorPage = async () => {
  const rwPaths = getPaths()

  const webFatalErrorPagesDir = path.join(rwPaths.web.pages, 'FatalErrorPage')
  const filename = path.join(webFatalErrorPagesDir, 'FatalErrorPage')
  const url =
    'https://raw.githubusercontent.com/cedarjs/cedar/aa89556781dddc4730d3c8605040dc63a1ba6c1a/packages/create-cedar-app/templates/ts/web/src/pages/FatalErrorPage/FatalErrorPage.tsx'

  const isTsxPage = fs.existsSync(
    path.join(webFatalErrorPagesDir, 'FatalErrorPage.tsx'),
  )
  const isJsxPage = fs.existsSync(
    path.join(webFatalErrorPagesDir, 'FatalErrorPage.jsx'),
  )
  const ext = isTsxPage ? 'tsx' : isJsxPage ? 'jsx' : 'js'

  const res = await fetch(url)
  const text = await res.text()
  const newFatalErrorPage = `${filename}.${ext}`

  fs.writeFileSync(newFatalErrorPage, text)
}
