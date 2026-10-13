// A sandboxed child script: runs in a locked-down process, reads its input
// from stdin and writes its result to stdout. It imports only packages.
import humanizeString from 'humanize-string'

const chunks: Buffer[] = []
for await (const chunk of process.stdin) {
  chunks.push(chunk)
}

process.stdout.write(humanizeString(Buffer.concat(chunks).toString()))
