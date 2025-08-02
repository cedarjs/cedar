export const handler = async (event, context) => {
  const body = JSON.parse(event.body)

  return {
    statusCode: 200,
    body: JSON.stringify({
      data: {
        user: {
          id: '1',
          name: 'Test User'
        }
      }
    })
  }
}

export default {
  handler
}
