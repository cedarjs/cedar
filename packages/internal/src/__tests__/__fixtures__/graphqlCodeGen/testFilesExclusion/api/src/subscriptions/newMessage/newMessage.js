import gql from 'graphql-tag'

export const schema = gql`
  type Subscription {
    newMessage: String! @skipAuth
  }
`

const newMessage = {
  newMessage: {
    subscribe: async function* () {
      const messages = ['Hello', 'World', 'from', 'Cedar']
      for (const msg of messages) {
        yield { newMessage: msg }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    },
  },
}

export default newMessage
