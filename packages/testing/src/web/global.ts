import type {
  mockGraphQLQuery as _mockGraphQLQuery,
  mockGraphQLMutation as _mockGraphQLMutation,
} from './mockRequests.js'

declare global {
  // eslint-disable-next-line no-var
  var mockGraphQLQuery: typeof _mockGraphQLQuery
  // eslint-disable-next-line no-var
  var mockGraphQLMutation: typeof _mockGraphQLMutation
  // @NOTE: not exposing mockCurrentUser here, because api side also has this functionality
  // We do this in the type generator
}
