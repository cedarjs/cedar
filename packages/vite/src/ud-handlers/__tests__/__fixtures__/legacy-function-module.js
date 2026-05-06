const handler = async (_event, _context) => {
  return {
    statusCode: 200,
    body: 'hello from legacy handler',
  }
}

module.exports = { handler }
