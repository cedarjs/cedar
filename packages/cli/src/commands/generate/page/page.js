import {
  createBuilder,
  createCommand,
  createDescription,
  createHandler,
} from '../yargsCommandHelpers.js'

const positionalsObj = {
  path: {
    description: 'URL path to the page, or just {param}. Defaults to name',
    type: 'string',
  },
}

export const command = createCommand('page')
export const description = createDescription('page')
export const builder = createBuilder({ componentName: 'page', positionalsObj })
export const handler = createHandler('page')
