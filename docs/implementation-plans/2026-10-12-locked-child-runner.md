# Locked child runner (`@cedarjs/api/sandbox`)

Plan for a small, dependency-free way to run a Node script on untrusted bytes in
a locked-down child process, exported from `@cedarjs/api/sandbox`. It is
extracted from a production Cedar app, where it runs sharp (libvips) on uploaded
photos and pdf.js on third parties' PDFs.

This is one of three related proposals that came out of the same work:

1. **Derived files (variants) in `@cedarjs/uploads`** — thumbnails and previews
   made from an upload. Making a variant means decoding an untrusted file, so
   variants would call this runner.
2. **Declarative recurring jobs and unique jobs in `@cedarjs/jobs`** — e.g.
   backfilling variants for files that don't have them yet, once per file.
3. **This runner.**

## Why

An app that accepts photos and PDFs from users or third parties decodes them
with large native or JavaScript parsers: libvips (C), pdf.js, archive and
spreadsheet libraries. Those parsers have bugs, and a crafted file that exploits
one runs code with whatever the process can reach. In a Cedar API process that
is everything: `DATABASE_URL`, API keys and session secrets in the environment,
`.env` on disk, every stored upload, the network.

Running the parser in a child process that has none of that turns "a parser bug
leaks every secret" into "a parser bug can read the file it was given". Node's
permission model makes that cheap: no container, no extra binary, no dependency,
and it works anywhere Node 24 does, including serverless functions on Netlify
and Vercel.

## What the runner does

- **Empty environment.** The child is spawned with `env: {}`.
- **Node's permission model.** `--permission`, with `--allow-fs-read` only for
  the child's script, the `node_modules` folders from the script's folder up,
  and the folders it's given. No `--allow-fs-write`, `--allow-child-process`,
  `--allow-worker`, `--allow-wasi` or `--allow-inspector`. `--allow-addons` only
  when the caller opts in (`allowAddons`), since sharp-like libraries are
  native.
- **No network.** No `--allow-net`, which on Node 25+ blocks the network. On
  Node 24, whose permission model doesn't cover the network, a preload does it
  for JavaScript (see Decisions).
- **No code from strings.** `--disallow-code-generation-from-strings`.
- **Bounded.** `--max-old-space-size`, a hard timeout (SIGKILL), an input cap
  checked before spawning, and an output cap that kills the child as soon as it
  is exceeded.
- **stdin in, stdout out.** The input goes to stdin; stdout is the result, and
  counts only on exit code 0. Every failure is a result
  (`{ ok: false, failure, message }`), never a rejection.
- **A concurrency limiter**, so a burst of uploads doesn't start a hundred Node
  processes.
- **`findChildScript`**, which finds a child script for its caller in every kind
  of build: from source, the regular API build, and the bundled (`--ud`) build
  on its own, on Netlify and on Vercel.

### The API

```ts
import {
  createConcurrencyLimiter,
  findChildScript,
  runSandboxedChild,
} from '@cedarjs/api/sandbox'

const limit = createConcurrencyLimiter(2)

const result = await limit(() =>
  runSandboxedChild({
    script: findChildScript(import.meta.dirname, 'thumbnail.child'),
    allowAddons: true,
    heapMb: 128,
    input: bytes,
    timeoutMs: 10_000,
    maxOutputBytes: 1024 * 1024,
    args: ['256'],
  })
)
// result: { ok: true, output: Buffer, stderr }
//       | { ok: false, failure: 'input-too-large' | 'timeout'
//           | 'output-too-large' | 'exit' | 'spawn-error', message, … }
```

Plus `sandboxedChildArgs()` (just the `node` arguments, for spawning the child
yourself) and `permissionModelBlocksNetwork()`.

## Decisions

### A real implementation with tests, not a docs recipe

The configuration is short, but it is coupled to things that change under an app
without warning: Node's flags (`--experimental-permission` became
`--permission`; `--allow-addons` arrived later; a network permission is arriving
now) and how native packages lay out their binaries (sharp moved its binaries
into `@img/*` optional packages, and sharp 0.35 doesn't export its
`package.json`, which breaks the obvious
`require.resolve('sharp/package.json')`). A recipe copied into an app breaks
silently; framework code with tests breaks in Cedar's CI first.

### `@cedarjs/api/sandbox`, not a new package

Every Cedar app's api side already depends on `@cedarjs/api`, and it already
groups api-side utilities as subpath exports (`/logger`, `/cache`, `/webhooks`).
The runner has no dependencies, so the subpath costs nothing for apps that don't
use it, and there's no new package to publish and version. `@cedarjs/uploads`
already depends on `@cedarjs/api`, so variants can import it directly.

### Names people (and agents) search for

The exports use "sandbox", "child" and "untrusted" (in the JSDoc), so someone
looking for "run untrusted code in a sandbox" finds `runSandboxedChild` rather
than writing their own `spawn` call. Every export has JSDoc with an example, and
`packages/api/src/sandbox/README.md` explains what is and isn't covered.

### Fail closed

Native addons are off unless asked for (`allowAddons`), the child reads nothing
of the app but its own script and `node_modules`, and every limit has a finite
default (256 MB heap, 10 s, 25 MiB in, 25 MiB out). `findChildScript` throws
when the script is missing, and a bundled build fails when a child imports app
code or two children share a name, rather than deploying something that fails
at run time.

### The child reads every `node_modules` from its script up, not a package list

The child may read each `node_modules` folder in its script's folder and every
folder above it: the folders Node looks in for the child's imports. A
`node_modules` that is a symlink is allowed by both its paths (Node reads a
package's `package.json` through the path it looked in, and its modules through
their real paths), and packages linked from it to somewhere outside (workspace
packages) by their real folders, except the workspace the script itself is in
and its siblings: a workspace manager links the app's own `api` and `web` sides
too, and those hold the app's source and maybe a SQLite database. pnpm's links point inside
`node_modules` and need nothing extra.

A precise list of the packages a child imports (walking each package's
`dependencies` and installed optional ones) adds nothing for the children that
matter most: the permission model doesn't restrict native addons, so for an
`allowAddons` child like sharp, the list limits only JavaScript that has no
reason to read other packages anyway. It's fragile too: sharp 0.35 doesn't
export its `package.json`, which breaks the obvious resolution, and each new
packaging scheme needs a fix. `node_modules` holds no app secrets, while the
app's root (`.env`), its `api` and `web` sides and its data stay unreadable
(linked workspace packages from elsewhere, like `packages/*`, are readable),
which is what the sandbox is for. There is no `sandboxReadPaths()` in the public API;
`nodeModulesFrom` changes where the walk starts, or turns it off. The walk
starts at the script, not the working directory, because that's where Node
resolves the child's imports from, and in a bundled build the copied packages
sit next to the children (below), which a walk from the working directory
misses. Yarn Plug'n'Play is not supported; Cedar apps use the `node-modules`
linker.

### No network on Node 24: a preload, as a `data:` URL

Node 25+ blocks the network under `--permission` unless `--allow-net` is passed
(TCP, Unix sockets, DNS, UDP, listening and `fetch` are all `ERR_ACCESS_DENIED`).
Cedar supports Node 24, whose permission model doesn't cover the network, so on
Node 24 (`permissionModelBlocksNetwork()` is false) the child loads a preload
with `--import` before its script. It closes every route JavaScript has:

- `net`, `tls`, `dgram`, `dns`, `http`, `https`, `http2` and their internal
  modules (`_http_agent`, `_tls_wrap`, …) can't be imported or required
  (`module.registerHooks` refuses to resolve them) or got with
  `process.getBuiltinModule` (wrapped);
- `net.Socket#connect`, `net.Server#listen`, `net.connect`, `tls.connect`, the
  dgram socket's `bind`, `connect` and `send`, and every `dns` and
  `dns.promises` function throw. They're patched on the module objects first,
  which Node's own users of them share (http uses net), before the hooks close
  the modules;
- `connect`, `bind`, `listen` and `open` throw on the prototype of the handles
  under stdin, stdout and stderr (a Pipe or a TTY), whose class could otherwise
  make a handle that connects to a Unix socket, such as a database's;
- `fetch`, `WebSocket` and `EventSource` are deleted.

`process.binding` is already denied by `--permission`. Native code makes its
own system calls, so none of this limits an addon.

The preload is a string in `@cedarjs/api`, passed as
`--import=data:text/javascript,…`, not a file. A file would have to be in the
published package, readable by the child and shipped by every deploy target,
and Netlify and Vercel bundle `@cedarjs/api` into their functions, where a file
next to it isn't. A `data:` URL needs no read permission and can't go missing:
a child runs with it or doesn't start, so it fails closed. A `sourceURL`
comment keeps stack traces from printing the whole URL.

### Child scripts in a bundled build: entries of their own, at a fixed path

The regular API build emits every file in `api/src` one-to-one
(`preserveModules`), so `thumbnail.child.js` lands next to its caller, and
`findChildScript(import.meta.dirname, 'thumbnail.child')` finds it. The bundled
build (`cedar build --ud`, for Universal Deploy, Netlify and Vercel) bundles the
API into `api/dist/ud`: the caller's code ends up in a chunk, and nothing
imports a child, so the bundle alone doesn't contain it.

The bundled build adds every `api/src/**/*.child.{ts,js,mts,mjs}` as an
entry of its own, emitted as `api/dist/ud/sandbox-children/<name>.child.js`,
and copies the packages the children import (from the emitted chunks' imports),
with their `dependencies` and installed optional and peer dependencies, into
`api/dist/ud/sandbox-children/node_modules`. `findChildScript` first looks next
to its caller, then for `api/dist/ud/sandbox-children/<name>.js` from the
caller's folder up. App code is the same in every build. The build fails when a
child imports app code (it couldn't read it) or two children share a name (they
share one folder).

Why this over the alternatives:

- A fixed path found by walking up survives the platforms bundling the build
  again. Netlify bundles `api/dist/ud` into its function's file under
  `web/.netlify/v1/functions`, and Vercel bundles each API function into its
  own `.func/index.mjs`, so the caller's `import.meta.url` points somewhere
  else after deploy. Both keep the app's layout from its root, so walking up
  from wherever the code runs reaches `api/dist/ud/sandbox-children`. A
  `new URL('./x.child.js', import.meta.url)` reference breaks under the second
  bundling, and Vite doesn't rewrite it in server builds.
- A manifest would need the same walk to find it, plus a file format, and adds
  nothing over a fixed folder with unique names.
- Copying the packages into the folder makes it self-contained. The platforms'
  file tracing doesn't follow a child (nothing imports it), and wouldn't find
  what native packages load at run time anyway: sharp's `.node` binary is in
  `@img/sharp-<platform>`, and libvips, which the binary links against, in
  `@img/sharp-libvips-<platform>`; both are installed optional dependencies,
  which the copy follows without naming a platform.

Deploy targets:

- **`cedar serve api --ud`** runs the folder in place.
- **Netlify**: its function bundler traces imports and leaves the children out,
  so `cedar setup deploy netlify --ud` writes
  `included_files = ["api/dist/ud/sandbox-children/**"]` under `[functions]`.
  The files keep their path in the function, so the walk up finds them.
- **Vercel**: `vite-plugin-vercel` bundles each function into a single file with
  no `node_modules` at all, so after the build Cedar copies
  `api/dist/ud/sandbox-children` into every Node function in
  `.vercel/output/functions/*.func`, at the same path from the function's root.
  Each function carries its own copy, which adds to its size.

On both, the function runs on an AWS Lambda-like Node runtime where spawning
`process.execPath` with the permission flags works. The file system is
read-only, which a child doesn't need anyway, and the child's working directory
is its script's folder. Native binaries must match the runtime's platform
(`linux-x64`, glibc), so the app must be built on Linux x64, as Netlify's and
Vercel's builds and the e2e CI runners are.

### Honest about what it isn't

Node's documentation says the permission model does not provide security
guarantees in the presence of malicious code. The runner is defense in depth. It
protects against an exploit that runs JavaScript in the child. It doesn't
constrain native code at all: with `allowAddons`, a memory-safety bug in a
native decoder can read files and open connections like any code in a process
of the server's user, and what still holds is the empty environment, the
separate process and its heap, time and output limits. The network preload
doesn't stop native code either. An external binary such as ffmpeg needs an
OS-level sandbox. The JSDoc and the README say all of this.

## What the tests guard

`packages/api/src/sandbox/*.test.ts`, run as part of `@cedarjs/api`'s tests.
Each probe is a real child script run through `runSandboxedChild`:

- the child sees none of the parent's environment (a secret set in the parent is
  absent);
- it can read the folders it's given, and not a file outside them (a `.env` next
  to them), nor the folder its own script is in;
- `nodeModulesReadPaths` finds every `node_modules` from a folder up, follows a
  symlinked workspace package but not the workspace the script is in, and never
  includes the app's root;
- it can't write a file, spawn a process, start a worker thread, `eval`, or
  `dlopen` a native addon without `allowAddons`;
- network, on every Node CI runs: a probe child tries TCP to a server in the
  parent, a Unix socket (a named pipe on Windows), `process.getBuiltinModule`,
  `require('http')` with a real request, `tls`, `fetch`, `WebSocket`, UDP to a
  socket in the parent, DNS, listening, connecting the `net.Socket` class of its
  stdout, `process.binding`, and a real `connect` on a new handle of its
  stdout's class. Every one must be refused and the parent's servers must see
  nothing. The child runs with an async `spawn`, so the servers in the same
  event loop can answer. Checked locally on Node 24 (the preload) and Node 26
  (the permission model); a test that the preload is passed only on Node 24;
- it's killed at the timeout, killed when its output passes the cap, refused
  before spawning when the input is over the cap, and fails when it runs out of
  heap;
- a failure reports the exit code and the last stderr line; a missing script is
  a failure, not a rejection;
- `findChildScript` finds a script next to its caller (built or from source),
  a bundled build's from `api/dist/ud` and its chunks and from a Netlify
  function's folder, and throws when there's none;
- `sandboxedChildArgs` resolves symlinks (an app deployed behind a
  `current -> releases/…` link);
- the limiter caps concurrency, runs waiting tasks in order, and frees a slot on
  rejection;
- **sharp in the child**, in an app laid out like a Cedar app (`node_modules` a
  symlink, a `.env` next to it): the child decodes a PNG and encodes a WebP
  reading only `node_modules`; it can't read the `.env`; it fails without
  `allowAddons` (`ERR_DLOPEN_DISABLED`) and without `node_modules`. sharp is a
  devDependency of `@cedarjs/api` for this (prebuilt binaries via optional
  packages, no build step);
- **the bundled build** (`packages/vite/src/__tests__/ud-build.test.ts`, on
  `__fixtures__/cedar-ud-app`, whose `humanize.child.ts` imports
  `humanize-string`): the child is emitted on its own, importing only the
  package; the package and its dependencies are copied next to it;
  `findChildScript` finds it from `api/dist/ud` and its chunks; it runs in the
  sandbox; and the regular build's child next to its caller runs too.
  `tasks/ud-tests` call a function that runs it under `cedar serve api --ud`
  and `cedar dev --ud`;
- **Netlify and Vercel** (`e2e-netlify.yml`, `e2e-vercel.yml`): a function from
  `tasks/sandbox-e2e` runs a pure-JS child that tries TCP to a public host and
  to the cloud metadata endpoint, `fetch`, DNS, and reading the function's own
  code, and a sharp child that makes an 8×8 WebP, on the deployed platform;
  `sandbox.test.mts` checks that every attempt is refused, the child's
  environment is empty, and the thumbnail is right.

## Not in this change

- **Lint rules.** A rule that flags parsing libraries (sharp, pdfjs-dist,
  archive and spreadsheet parsers) imported in api code outside a sandboxed
  child would make this discoverable at the point of use. That's a separate
  step; the framework repo is moving from ESLint to oxlint
  ([plan](./2026-09-12-oxlint-and-oxfmt-migration.md)), and Cedar apps would get
  the rule through Cedar's lint config.
- **Sniffing a file's type by its bytes.** The caller should only send the child
  formats it is meant to decode, judged by magic bytes rather than the claimed
  content type. That belongs in `@cedarjs/uploads`, next to variants, not here.
- **pdf.js and other presets.** The production app also renders PDF pages with
  pdf.js and `@napi-rs/canvas` in the same runner; that, and the sharp
  thumbnailer itself, belong with variants in `@cedarjs/uploads`.

## Decided

- **Network on Node 24.** A preload on Node 24, the permission model on Node
  25+. See Decisions.
- **Read paths.** Every `node_modules` from the script up, not a per-package
  list, and no `sandboxReadPaths()`. See Decisions.
- **Child script location in builds.** Bundled builds (`--ud`), Netlify and
  Vercel are supported: children are emitted to
  `api/dist/ud/sandbox-children` with their packages. See Decisions.
- **Windows.** The permission model works on Windows, and Windows CI runs the
  tests. libuv always passes a few system variables to a child process on
  Windows (`PATH`, `SYSTEMROOT`, `TEMP`, `USERNAME`, `USERPROFILE` and the
  like); the README documents it, and none of the app's own variables reach
  the child.

## Open questions

- **Allowing code generation.** `eval` is always off. Some libraries need it
  (older pdf.js builds, some template engines). An `allowCodeGeneration` option
  is easy to add if a real use comes up.
- **A ready-made sharp preset.** Variants will need "sharp in a sandboxed child"
  with the libvips loaders restricted. Should that live in `@cedarjs/uploads`
  (with variants) or here?
- **A pool instead of a process per call.** A Node child costs a few tens of ms
  and tens of MB to start. A pool of warm children would be faster but would let
  one input's exploit see the next input. One process per input is the safer
  default; revisit only with a measured need.
- **Vercel function size.** Every Vercel Node function gets a copy of the
  children and their packages (sharp and libvips are about 20 MB). Copying
  only into functions whose bundle uses `findChildScript` would need the build
  to know which do.
