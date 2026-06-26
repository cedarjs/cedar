export const handler = async (_event: any, _context: any) => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: 'hello from legacy handler' }),
  }
}
