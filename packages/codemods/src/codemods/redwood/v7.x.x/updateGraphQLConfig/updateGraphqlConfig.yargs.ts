import task from 'tasuku'

import { updateGraphqlConfig } from './updateGraphqlConfig'

export const command = 'redwood/update-graphql-config'
export const description =
  '(v6.x->v7.x) Update graphql.config.js from the create-cedar-app template'

export const handler = () => {
  task('Update root graphql.config.js file', async () => {
    await updateGraphqlConfig()
  })
}
