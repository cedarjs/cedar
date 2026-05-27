export async function handleRequest(request: Request) {
  return new Response(
    JSON.stringify({ data: 'hello from cedar', url: request.url }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}
