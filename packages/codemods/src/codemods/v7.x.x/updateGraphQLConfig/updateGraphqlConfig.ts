import fs from 'fs'
import path from 'path'

import { fetch } from '@whatwg-node/fetch'

import { getPaths } from '@cedarjs/project-config'

export const updateGraphqlConfig = async () => {
  const res = await fetch(
    // TODO: Have to come back here to update the URL when we have a more
    // stable location than main
    // 'https://raw.githubusercontent.com/redwoodjs/redwood/release/major/v7.0.0/packages/create-cedar-app/templates/ts/graphql.config.js'
    'https://raw.githubusercontent.com/cedarjs/cedar/refs/tags/v0.4.0/packages/create-cedar-app/templates/ts/graphql.config.js',
  )
  const text = await res.text()
  fs.writeFileSync(path.join(getPaths().base, 'graphql.config.js'), text)
}
