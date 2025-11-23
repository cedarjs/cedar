import gql from 'graphql-tag'

import { createValidatorDirective } from '@cedarjs/graphql-server'

export const schema = gql`
  directive @requireAuth(roles: [String]) on FIELD_DEFINITION
`

const validate = ({ directiveArgs }) => {
  const { roles } = directiveArgs
  // Stub implementation for testing
}

const requireAuth = createValidatorDirective(schema, validate)

export default requireAuth
