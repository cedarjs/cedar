export const gql = (strings, ...values) => {
  const query = strings.reduce((result, cur, i) => {
    return result + cur + (values[i] || '')
  }, '')

  return { query, __isGqlTemplate: true }
}

export default gql
