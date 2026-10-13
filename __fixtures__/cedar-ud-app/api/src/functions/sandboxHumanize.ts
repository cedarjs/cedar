import { humanize } from 'src/lib/humanize'

export async function handleRequest(_request: Request) {
  return new Response(
    JSON.stringify({ data: await humanize('sandboxed_childScript') }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}
