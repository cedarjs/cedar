import {
  createBuilder,
  createCommand,
  createHandler,
  getYargsDefaults,
} from '../yargsCommandHelpers.js'

export const command = createCommand('directive')
export const description = 'Generate a new GraphQL directive'
export const builder = createBuilder({
  componentName: 'directive',
  optionsObj: () => ({
    ...getYargsDefaults(),
    // No default value, so the handler prompts for a type when the option is
    // omitted
    type: {
      description: 'Directive type. If omitted, the generator prompts for one',
      type: 'string',
      choices: ['validator', 'transformer'],
    },
  }),
})
export const handler = createHandler('directive')
