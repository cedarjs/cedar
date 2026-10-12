// A sandboxed child that tries what an exploit in a parser could: the
// network (a public host, the cloud metadata endpoint, DNS), the
// environment, and the server's own code. Prints what each attempt got.
import fs from 'node:fs'

const [callerFile] = process.argv.slice(2)
const results: Record<string, string> = {}

const attempt = async (name: string, fn: () => Promise<unknown>) => {
  let onUncaught: ((e: unknown) => void) | undefined
  try {
    const got = await new Promise((resolve, reject) => {
      onUncaught = reject
      process.once('uncaughtException', onUncaught)
      setTimeout(() => reject(new Error('timed out')), 3000).unref()
      Promise.resolve().then(fn).then(resolve, reject)
    })
    results[name] = `ALLOWED: ${String(got)}`
  } catch (e) {
    const code =
      e && typeof e === 'object' && 'code' in e ? String(e.code) : undefined
    results[name] =
      `refused: ${code ?? (e instanceof Error ? e.message : String(e))}`
  } finally {
    if (onUncaught) {
      process.off('uncaughtException', onUncaught)
    }
  }
}

const connect = async (host: string, port: number) => {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host)
    socket.on('connect', () => {
      socket.destroy()
      resolve('connected')
    })
    socket.on('error', reject)
  })
}

await attempt('tcp to a public host', () => connect('1.1.1.1', 80))
await attempt('tcp to the metadata endpoint', () =>
  connect('169.254.169.254', 80),
)
await attempt('fetch', async () => (await fetch('https://example.com/')).status)
await attempt(
  'dns',
  async () =>
    (await (await import('node:dns/promises')).lookup('example.com')).address,
)
await attempt('read the server code', async () =>
  fs.readFileSync(callerFile, 'utf8').slice(0, 20),
)

process.stdout.write(
  JSON.stringify({ results, env: Object.keys(process.env).sort() }),
)
