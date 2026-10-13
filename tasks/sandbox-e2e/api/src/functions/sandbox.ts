// Copied into the test project by the Netlify and Vercel e2e workflows:
// runs sandboxed child scripts on the deployed platform and reports what
// they could and couldn't do. See tasks/sandbox-e2e/sandboxChecks.mts
import { runSandboxChecks } from 'src/lib/sandbox'

export async function handleRequest(_request: Request) {
  return new Response(JSON.stringify(await runSandboxChecks()), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
