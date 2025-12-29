import task from 'tasuku'

import { updateDevFatalErrorPage } from './updateDevFatalErrorPage'

export const command = 'redwood/update-dev-fatal-error-page'
export const description =
  '(v5.x.x->v6.x.x) Update Fatal Error Page with development version from the create-cedar-app template'

export const handler = () => {
  task('Update Fatal Error Page with regular import', async () => {
    await updateDevFatalErrorPage()
  })
}
