export async function handler(event: any, _context: any) {
  const n = 5
  const msg = `hello ${n}`
  return {
    statusCode: 200,
    body: JSON.stringify({ data: msg }),
  }
}
