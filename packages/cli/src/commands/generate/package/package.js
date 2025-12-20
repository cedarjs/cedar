import { createHandler, createBuilder } from '../yargsCommandHelpers.js'

export const command = 'package <name>'
export const description = 'Generate a workspace Package'

export const builder = createBuilder({
  componentName: 'package',
  addStories: false,
})

export const handler = createHandler('package')
