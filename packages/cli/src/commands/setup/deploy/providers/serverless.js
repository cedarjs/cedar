import { createHandler } from '../helpers/helpers.js'

export const command = 'serverless'
export const description =
  '[DEPRECATED]\n' +
  'Setup Serverless Framework AWS deploy\n' +
  'For more information:\n' +
  'https://cedarjs.com/docs/deploy/serverless'

export const aliases = ['aws-serverless']
export const handler = createHandler('serverless')
