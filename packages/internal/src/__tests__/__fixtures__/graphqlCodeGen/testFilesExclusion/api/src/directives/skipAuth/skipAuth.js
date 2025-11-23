import gql from 'graphql-tag'

import { createValidatorDirective } from '@cedarjs/graphql-server'

export const schema = gql`
  directive @skipAuth on FIELD_DEFINITION
`

const validate = () => {
  // Stub implementation for testing
}

const skipAuth = createValidatorDirective(schema, validate)

export default skipAuth
