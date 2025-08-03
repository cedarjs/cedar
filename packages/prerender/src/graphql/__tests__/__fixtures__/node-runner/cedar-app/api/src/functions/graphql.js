export const handler = async (_event, _context) => {
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
