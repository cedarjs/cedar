import gql from 'graphql-tag'

export const schema = gql`
  type Subscription {
    countdown: Int! @skipAuth
  }
`

const countdown = {
  countdown: {
    subscribe: async function* () {
      for (let i = 10; i >= 0; i--) {
        yield { countdown: i }
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    },
  },
}

export default countdown
