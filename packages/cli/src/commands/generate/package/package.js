import {
  createHandler,
  createBuilder,
  getYargsDefaults,
} from '../yargsCommandHelpers.js'

export const command = 'package <name>'
export const description = 'Generate a workspace Package'

export const builder = createBuilder({
  componentName: 'package',
  addStories: false,
  optionsObj: () => ({
    ...getYargsDefaults(),
    workspace: {
      alias: 'w',
      description:
        "Which workspace(s) should use this package? One of: 'none', 'api', " +
        "'web', 'both'. If provided, the generator will skip the interactive " +
        'prompt and apply the chosen workspace.',
      type: 'string',
      choices: ['none', 'api', 'web', 'both'],
    },
  }),
})

export const handler = createHandler('package')
