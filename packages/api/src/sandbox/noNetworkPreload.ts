/**
 * Whether this Node's permission model restricts network access. On Node
 * 25 and later it does: under `--permission`, without `--allow-net`, a
 * child can't open sockets, listen, look up names or `fetch`. On Node 24
 * it doesn't, so `runSandboxedChild()` loads a preload that takes the
 * network away from JavaScript instead (see `NO_NETWORK_PRELOAD`).
 *
 * Neither limits native code: an addon makes its own system calls.
 */
export const permissionModelBlocksNetwork = () =>
  process.allowedNodeEnvironmentFlags.has('--allow-net')

/**
 * The source of the preload a sandboxed child loads (`--import`) before its
 * own script on a Node whose permission model doesn't restrict the network.
 * It closes every route to the network that JavaScript has:
 *
 * - `net`, `tls`, `dgram`, `dns`, `http`, `https` and `http2` (and the
 *   internal modules behind them) can't be imported, required or got with
 *   `process.getBuiltinModule`;
 * - the functions that open a connection or a listening socket throw, so a
 *   socket reached some other way can't connect either: a pipe on stdout is
 *   a `net.Socket`, and the handle under it can connect to a Unix socket;
 * - every `dns` and `dns.promises` function throws;
 * - `fetch`, `WebSocket` and `EventSource` are gone.
 *
 * `process.binding`, the lower route to sockets, the permission model
 * already denies.
 *
 * It's plain JavaScript in a string, passed to Node as a `data:` URL, so
 * there's no file that a build or a deploy could leave out: a child either
 * runs with it or doesn't start. (The `sourceURL` names it in stack traces,
 * instead of the whole URL.) It must never run in the server process,
 * which would lose its own network.
 */
const NO_NETWORK_PRELOAD = String.raw`
const BLOCKED = new Set([
  'net',
  'tls',
  'dgram',
  'dns',
  'dns/promises',
  'http',
  'https',
  'http2',
  '_http_agent',
  '_http_client',
  '_http_common',
  '_http_incoming',
  '_http_outgoing',
  '_http_server',
  '_tls_common',
  '_tls_wrap',
])

const isBlocked = (id) =>
  typeof id === 'string' && BLOCKED.has(id.replace(/^node:/, ''))

const refuse = (what) =>
  function noNetwork() {
    throw new Error('No network access in a sandboxed child (' + what + ')')
  }

const getBuiltinModule = process.getBuiltinModule.bind(process)
const { registerHooks, syncBuiltinESMExports } =
  getBuiltinModule('node:module')

// The modules themselves first, before the hooks below make them
// unreachable. Builtin modules are shared, so Node's own users of them
// (http uses net) get the patched functions too
const net = getBuiltinModule('node:net')
net.Socket.prototype.connect = refuse('net.Socket#connect')
net.Server.prototype.listen = refuse('net.Server#listen')
net.connect = refuse('net.connect')
net.createConnection = refuse('net.createConnection')

const tls = getBuiltinModule('node:tls')
tls.connect = refuse('tls.connect')

const dgram = getBuiltinModule('node:dgram')
for (const name of ['bind', 'connect', 'send']) {
  dgram.Socket.prototype[name] = refuse('dgram.Socket#' + name)
}

const dns = getBuiltinModule('node:dns')
for (const [label, api] of [
  ['dns', dns],
  ['dns.promises', dns.promises],
]) {
  for (const name of Object.keys(api)) {
    if (typeof api[name] === 'function') {
      api[name] = refuse(label + '.' + name)
    }
  }
}

// The handles under stdin, stdout and stderr (a Pipe or a TTY). Their
// class can make new handles that connect or bind, e.g. to a Unix socket.
// Reading process.stdin and friends here also opens the child's own stdio
// before open() is taken away
for (const stream of [process.stdin, process.stdout, process.stderr]) {
  const handle = stream._handle
  const proto = handle && Object.getPrototypeOf(handle)
  if (!proto) {
    continue
  }
  for (const name of ['bind', 'bind6', 'connect', 'connect6', 'listen', 'open']) {
    if (typeof proto[name] === 'function') {
      proto[name] = refuse(handle.constructor.name + '#' + name)
    }
  }
}

syncBuiltinESMExports()

// Then the ways to the modules
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (isBlocked(specifier)) {
      refuse('import of ' + specifier)()
    }
    return nextResolve(specifier, context)
  },
})

process.getBuiltinModule = (id) => {
  if (isBlocked(id)) {
    refuse('process.getBuiltinModule(' + id + ')')()
  }
  return getBuiltinModule(id)
}

for (const name of ['fetch', 'WebSocket', 'EventSource']) {
  delete globalThis[name]
}

//# sourceURL=cedar-sandbox-no-network-preload.js
`

/**
 * The `--import` argument that loads the no-network preload, as a `data:`
 * URL. Loading it needs no file and no read permission.
 */
export const noNetworkPreloadArg = () =>
  `--import=data:text/javascript,${encodeURIComponent(NO_NETWORK_PRELOAD)}`
