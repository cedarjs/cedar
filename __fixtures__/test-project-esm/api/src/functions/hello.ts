export async function handleRequest(_request: Request) {
  return new Response(JSON.stringify({ data: 'hello from cedar' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
