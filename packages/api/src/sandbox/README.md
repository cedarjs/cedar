# Sandbox: run code on untrusted input in a locked-down child process

`@cedarjs/api/sandbox` runs a Node script on untrusted bytes — an uploaded
photo, a PDF from a third party, an archive, a spreadsheet — in a sandboxed
child process. If a crafted file exploits a bug in the parser, it lands in a
process that has none of your secrets and can't read or write your files.

Use it whenever your API side parses, decodes or converts a file it didn't
create: resizing images with sharp (libvips), rendering PDF pages with pdf.js,
extracting text, unpacking archives.

```ts
import {
  createConcurrencyLimiter,
  findChildScript,
  runSandboxedChild,
  sandboxReadPaths,
} from '@cedarjs/api/sandbox'
```

## What the child can and can't do

| The child…                                             | How                                                     |
| ------------------------------------------------------ | ------------------------------------------------------- |
| has no environment variables (no `DATABASE_URL`, keys) | spawned with `env: {}` (on Windows, see below)          |
| reads only its script and the `readable` paths         | Node's permission model, `--allow-fs-read`              |
| can't write files                                      | permission model (no `--allow-fs-write`)                |
| can't start processes or worker threads                | permission model (no `--allow-child-process`/`-worker`) |
| can't `eval` or `new Function`                         | `--disallow-code-generation-from-strings`               |
| loads native addons only if you allow it               | `allowAddons` → `--allow-addons`                        |
| gets the input on stdin, returns the result on stdout  | output counts only on exit code 0                       |
| is bounded                                             | heap cap, timeout (SIGKILL), input and output caps      |

On Windows the child still gets a few system variables (`PATH`, `SYSTEMROOT`,
`TEMP`, `USERNAME`, `USERPROFILE` and the like): Node's process library
(libuv) always passes them on. None of your app's own variables reach it.

Every failure is a result, never a rejection: `{ ok: false, failure, message }`,
where `failure` is `'input-too-large'`, `'timeout'`, `'output-too-large'`,
`'exit'` or `'spawn-error'`.

## Example: thumbnails with sharp

The parent, on the API side:

```ts
// api/src/lib/thumbnail.ts
import {
  createConcurrencyLimiter,
  findChildScript,
  runSandboxedChild,
  sandboxReadPaths,
} from '@cedarjs/api/sandbox'

import { logger } from 'src/lib/logger'

// Each child is a whole Node process: two at a time per server process
const limit = createConcurrencyLimiter(2)

export const makeThumbnail = async (image: Uint8Array) => {
  // thumbnail.child.js in the build, thumbnail.child.ts from source
  const script = findChildScript(import.meta.dirname, 'thumbnail.child')
  if (!script) {
    throw new Error('thumbnail.child is missing from the build')
  }

  const result = await limit(() =>
    runSandboxedChild({
      script,
      // sharp, its platform binary and libvips, and what sharp imports
      readable: sandboxReadPaths(['sharp'], { from: import.meta.url }),
      // sharp is a native addon
      allowAddons: true,
      heapMb: 128,
      input: image,
      timeoutMs: 10_000,
      maxInputBytes: 40 * 1024 * 1024,
      maxOutputBytes: 1024 * 1024,
      args: ['256'],
    }),
  )

  if (!result.ok) {
    logger.warn({ failure: result.failure }, `no thumbnail: ${result.message}`)
    return null
  }

  // The output is untrusted too: check it's what you asked for
  const isWebp = result.output.toString('latin1', 8, 12) === 'WEBP'
  return isWebp ? result.output : null
}
```

The child, next to it. It's run by plain Node, so it can't use path aliases like
`src/…` or TypeScript-only syntax such as enums, and it can only import what
`readable` covers:

```ts
// api/src/lib/thumbnail.child.ts
import sharp from 'sharp'

const size = Number(process.argv[2])

const chunks: Buffer[] = []
for await (const chunk of process.stdin) {
  chunks.push(chunk)
}

// Only the decoders you need: every other libvips loader stays off
sharp.block({ operation: ['VipsForeignLoad'] })
sharp.unblock({
  operation: ['VipsForeignLoadJpegBuffer', 'VipsForeignLoadPngBuffer'],
})

const webp = await sharp(Buffer.concat(chunks), {
  failOn: 'error',
  limitInputPixels: 100_000_000,
})
  .rotate()
  .resize(size, size, { fit: 'cover' })
  .webp()
  .toBuffer()

process.stdout.write(webp)
```

Write errors to stderr and exit non-zero: the last stderr line becomes the
failure `message`.

## Which folders the child may read

The permission model checks every file the child opens, including each
`package.json` and `.node` binary Node loads while importing a package. So a
child that imports a package needs read access to that package's folder and to
the folders of everything it imports in turn. `sandboxReadPaths()` works those
out by walking the installed `node_modules` from where you call it: each
package's `dependencies`, plus the `optionalDependencies` and `peerDependencies`
that are installed. That covers native libraries that ship their binaries as
platform-specific optional packages (sharp's `@img/sharp-<platform>` and
`@img/sharp-libvips-<platform>`), without hard-coding any platform.

Nothing else is readable: not your app's source, not `.env`, not the folder the
child's own script is in (just the script itself).

## What this does not protect against

This is **defense in depth, not a security boundary**. Use it on top of
validating input (check a file's real type by its bytes, cap its size), not
instead of it.

- Node documents that its
  [permission model](https://nodejs.org/api/permissions.html) "does not provide
  security guarantees in the presence of malicious code": it limits what
  well-behaved code can reach by accident, and raises the bar for an exploit,
  but a determined attacker who gets code running in the child may find a way
  around it.
- **Native code isn't covered at all.** With `allowAddons`, a native addon — or
  an attacker who has taken over one through a parser bug in it — can do
  anything the operating system allows the process. What still holds then is
  what the OS enforces: the empty environment, the heap cap and the timeout. An
  external binary (ffmpeg, ImageMagick, LibreOffice) needs an OS-level sandbox
  instead: a container, a separate user, seccomp, gVisor.
- **Network access** is restricted only on Node versions whose permission model
  includes a network permission (`--allow-net`). `sandboxBlocksNetwork()` tells
  you which you're on. On Node 24 the child can open connections: to your
  database, to other services on your private network, to a cloud provider's
  metadata endpoint. It has no credentials from the environment, but block
  outbound traffic at the OS or network level if that matters to you.
- The output is untrusted. Check it before you store or serve it.
- Each child is a full Node process (tens of MB of memory, a few tens of ms to
  start). Use `createConcurrencyLimiter()` so a burst of uploads can't start
  hundreds.

## API

- `runSandboxedChild(options)` — run a script on `input`, get
  `{ ok: true, output }` or `{ ok: false, failure, message }`. Options:
  `script`, `input`, `readable`, `allowAddons`, `heapMb` (256), `args`,
  `timeoutMs` (10 000), `maxInputBytes` (25 MiB), `maxOutputBytes` (25 MiB),
  `cwd` (the script's folder).
- `sandboxedChildArgs(options)` — just the `node` arguments, for spawning the
  child yourself (e.g. with `spawnSync` in a test). Pass `env: {}` too.
- `sandboxReadPaths(packages, { from, dependencies })` — the folders a child
  needs to read to import `packages`.
- `createConcurrencyLimiter(max)` — at most `max` tasks at once, the rest in
  order.
- `findChildScript(dir, baseName)` — `<baseName>.js` or `<baseName>.ts` in
  `dir`, whichever exists.
- `sandboxBlocksNetwork()` — whether this Node's permission model restricts
  network access.
