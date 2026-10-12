# Sandbox: run code on untrusted input in a locked-down child process

`@cedarjs/api/sandbox` runs a Node script on untrusted bytes — an uploaded
photo, a PDF from a third party, an archive, a spreadsheet — in a sandboxed
child process. If a crafted file exploits a bug in the parser, it lands in a
process that has none of your secrets, can read only its script, `node_modules`
and the paths you allow, can't write files, and has no network (all of which
holds for JavaScript; see what it doesn't cover for native addons).

Use it whenever your API side parses, decodes or converts a file it didn't
create: resizing images with sharp (libvips), rendering PDF pages with pdf.js,
extracting text, unpacking archives.

```ts
import {
  createConcurrencyLimiter,
  findChildScript,
  runSandboxedChild,
} from '@cedarjs/api/sandbox'
```

## What the child can and can't do

| The child…                                                                  | How                                                        |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| has no environment variables (no `DATABASE_URL`, keys)                      | spawned with `env: {}` (on Windows, see below)             |
| reads only its script, `node_modules` and `readable`                        | Node's permission model, `--allow-fs-read`                 |
| can't write files                                                           | permission model (no `--allow-fs-write`)                   |
| can't start processes or worker threads                                     | permission model (no `--allow-child-process`/`-worker`)    |
| has no network: no sockets, no `fetch`, no DNS                              | permission model on Node 25+; a preload on Node 24 (below) |
| can't `eval` or `new Function`                                              | `--disallow-code-generation-from-strings`                  |
| loads native addons only if you allow it                                    | `allowAddons` → `--allow-addons`                           |
| gets the input on stdin, returns the result on stdout                       | output counts only on exit code 0                          |
| is bounded                                                                  | heap cap, timeout (SIGKILL), input and output caps         |
| in native code (`allowAddons`): none of the file, network or process limits | the permission model doesn't apply to native code          |

**None of the permission model's limits — files, network, processes — apply to
native code.** With `allowAddons`, an addon (or an exploit in one) makes its own
system calls. What still holds for those children is the empty environment, the
separate process and the heap, time and output limits. See
[what this doesn't protect against](#what-this-protects-against-and-what-it-doesnt).

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
} from '@cedarjs/api/sandbox'

import { logger } from 'src/lib/logger'

// Each child is a whole Node process: two at a time per server process
const limit = createConcurrencyLimiter(2)

export const makeThumbnail = async (image: Uint8Array) => {
  const result = await limit(() =>
    runSandboxedChild({
      // thumbnail.child.ts next to this file, in every kind of build
      script: findChildScript(import.meta.dirname, 'thumbnail.child'),
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
`src/…` or TypeScript-only syntax such as enums, and it may import packages and
Node builtins only, never your app's own modules:

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

## Which files the child may read

The permission model checks every file the child opens, including each
`package.json` and `.node` binary Node loads while importing a package. The
child may read:

- its own script (not the folder it's in);
- every `node_modules` folder in the script's folder and each folder above it,
  which is where Node looks for its imports (`nodeModulesFrom` to start
  elsewhere, `false` for none). A `node_modules` that is a symlink is allowed
  by both its paths, and packages linked from it to somewhere else (workspace
  packages such as `packages/*`) by their real folders, except the workspace
  the script is in and its siblings (the app's `api` and `web` sides);
- whatever you pass as `readable`.

Nothing else: not your app's root, so not `.env`, and not your source, your
database file or uploaded files, unless they're in a folder you allow (through
`readable`, or a linked package you keep them in).

## Child scripts in every build

Call `findChildScript(import.meta.dirname, '<name>.child')` from a module next
to the child script. It finds the script in every kind of build, so your code
doesn't change between them:

- **From source** (tests, `cedar exec`, `cedar dev`): `<name>.child.ts`, which
  Node runs by stripping its types.
- **A regular build** (`cedar build`, for `cedar serve`, baremetal, Docker): the
  API build emits each file one-to-one, so `<name>.child.js` is next to its
  caller.
- **A bundled build** (`cedar build --ud`, for Universal Deploy, Netlify and
  Vercel): the caller is part of a bundle, and nothing imports the child, so the
  build emits each child as an entry of its own, at
  `api/dist/ud/sandbox-children/<name>.child.js`, and copies the packages the
  children import (with their dependencies and their installed optional
  dependencies, which is where native packages keep their binaries) into
  `api/dist/ud/sandbox-children/node_modules`. `findChildScript` looks for that
  folder from its caller's folder up. Child script names must be unique in
  `api/src`, and the build fails when a child imports your app's own code.
  - **Netlify**: `cedar setup deploy netlify --ud` adds
    `included_files = ["api/dist/ud/sandbox-children/**"]` to `[functions]` in
    `netlify.toml`, because Netlify ships only the files it can trace from your
    API's imports. Add it yourself to a `netlify.toml` written before.
  - **Vercel**: each function is a single bundled file, so the build copies
    `api/dist/ud/sandbox-children` into every Node function in
    `.vercel/output/functions`.

Netlify and Vercel run functions on AWS Lambda-like runtimes, where starting
`process.execPath` with the permission flags works and the file system is
read-only, which a child doesn't mind. A native package's binaries must match
the platform the function runs on (sharp's `@img/sharp-linux-x64`), so build on
Linux x64, as Netlify's and Vercel's builds and most CI runners do. Each Vercel
function carries its own copy of the children's packages, which adds to its
size.

## No network

On Node 25 and later, the permission model blocks the network: without
`--allow-net` a child can't open a socket, listen, look up a name or `fetch`.
`permissionModelBlocksNetwork()` tells you whether this Node does.

Node 24's permission model doesn't cover the network, so there the child loads
a preload first (`--import`, as a `data:` URL, so there's no file a build or a
deploy could lose). It closes every route JavaScript has to the network:

- `net`, `tls`, `dgram`, `dns`, `http`, `https` and `http2` (and the internal
  modules behind them) can't be imported, required or got with
  `process.getBuiltinModule`;
- the functions that connect or listen (`net.Socket#connect`,
  `net.Server#listen`, `tls.connect`, the dgram socket's `bind`, `connect` and
  `send`, every `dns` and `dns.promises` function) throw, so a socket reached
  some other way can't connect either;
- the handles under stdin, stdout and stderr can't connect, bind, listen or
  open, so they can't reach a Unix socket (your database's, say);
- `fetch`, `WebSocket` and `EventSource` are gone;
- `process.binding` is denied by the permission model.

None of this applies to native code (see below).

## What this protects against, and what it doesn't

This is **defense in depth, not a security boundary**. Use it on top of
validating input (check a file's real type by its bytes, cap its size), not
instead of it.

It protects against a parser bug that runs **JavaScript** in the child (a
crafted PDF that exploits pdf.js, an archive that exploits a pure-JS unpacker):
that code finds no secrets in its environment; can't read `.env`, your source,
database files or other uploads outside the paths it's allowed; can't write files or start processes; can't
reach your database or a cloud metadata endpoint over the network; and is
killed at the heap cap, the timeout or the output cap.

- Node documents that its
  [permission model](https://nodejs.org/api/permissions.html) "does not provide
  security guarantees in the presence of malicious code": it raises the bar for
  an exploit, but a determined attacker who gets code running in the child may
  find a way around it.
- **Native code isn't limited by the permission model at all.** With
  `allowAddons` (sharp, `@napi-rs/canvas`), the addon makes its own system
  calls: a memory-safety bug in a native decoder, such as one in libvips, can
  read any file and open any connection the server's own OS user could. For
  those children what holds is what every process gets from the OS: the empty
  environment, the separate process (it shares no memory with your server), the
  heap cap, the timeout and the output cap. The network preload doesn't stop
  native code either. An external binary (ffmpeg, ImageMagick, LibreOffice)
  needs an OS-level sandbox instead: a container, a separate user, seccomp,
  gVisor.
- The output is untrusted. Check it before you store or serve it.
- Each child is a full Node process (tens of MB of memory, a few tens of ms to
  start). Use `createConcurrencyLimiter()` so a burst of uploads can't start
  hundreds.

## API

- `runSandboxedChild(options)` — run a script on `input`, get
  `{ ok: true, output }` or `{ ok: false, failure, message }`. Options:
  `script`, `input`, `readable`, `nodeModulesFrom` (the script's folder),
  `allowAddons`, `heapMb` (256), `args`, `timeoutMs` (10 000), `maxInputBytes`
  (25 MiB), `maxOutputBytes` (25 MiB), `cwd` (the script's folder).
- `findChildScript(dir, baseName)` — the child script for a caller in `dir`, in
  every kind of build (see above). Throws when there's none.
- `createConcurrencyLimiter(max)` — at most `max` tasks at once, the rest in
  order.
- `sandboxedChildArgs(options)` — just the `node` arguments, for spawning the
  child yourself (e.g. in a test). Pass `env: {}` too.
- `permissionModelBlocksNetwork()` — whether this Node's permission model blocks
  the network itself (Node 25+), so no preload is needed.
