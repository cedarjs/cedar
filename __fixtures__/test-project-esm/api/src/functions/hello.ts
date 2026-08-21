import { validateEmail } from '@my-org/validators'

import { greeting } from 'src/lib/greeting.ts'

export async function handleRequest(request: Request) {
  const url = new URL(request.url)
  const email = url.searchParams.get('email')

  if (email) {
    const valid = validateEmail(email)
    return new Response(
      JSON.stringify({ data: greeting(), url: request.url, email, valid }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  return new Response(JSON.stringify({ data: greeting(), url: request.url }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
