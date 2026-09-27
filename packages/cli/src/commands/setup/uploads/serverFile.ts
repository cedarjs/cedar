/**
 * Plain-text editing of `api/src/server.ts` for `cedar setup uploads`: adds
 * the imports the upload plugin needs and registers it right before the
 * server starts. Throws `CEDAR_UPLOADS_ERR_NO_START` when the file has no
 * `await server.start()` line to anchor on, and returns the source unchanged
 * when the plugin is already registered.
 */

import { isBuiltin } from 'node:module'

/**
 * How the app builds its auth decoder, detected from
 * `api/src/functions/graphql`. dbAuth exposes a `createAuthDecoder(cookieName)`
 * factory; every other provider exports a ready-made `authDecoder`.
 */
export interface UploadsServerAuth {
  decoderPackage: string
  usesFactory: boolean
}

const START_LINE = /^([ \t]*)await server\.start\(\)/m

const FACTORY_IMPORT =
  /import\s*\{[^}]*\bcreateAuthDecoder\b[^}]*\}\s*from\s*['"](@cedarjs\/auth-[a-z0-9-]+-api)['"]/
const DECODER_IMPORT =
  /import\s*\{[^}]*\bauthDecoder\b[^}]*\}\s*from\s*['"](@cedarjs\/auth-[a-z0-9-]+-api)['"]/

/**
 * Detects the auth decoder the app's GraphQL handler uses, so the upload
 * plugin can be registered with the same identity pipeline. Returns `null`
 * when the handler does not import one.
 */
export function detectServerAuth(
  graphqlSource: string,
): UploadsServerAuth | null {
  const factory = FACTORY_IMPORT.exec(graphqlSource)

  if (factory) {
    return { decoderPackage: factory[1], usesFactory: true }
  }

  const decoder = DECODER_IMPORT.exec(graphqlSource)

  if (decoder) {
    return { decoderPackage: decoder[1], usesFactory: false }
  }

  return null
}

/**
 * Local names a module-level import statement introduces at runtime.
 * `import type` and inline `type` specifiers bind nothing at runtime, and an
 * aliased specifier binds its alias, not the exported name.
 */
export function importedBindings(source: string): Set<string> {
  const names = new Set<string>()
  const statements = source.matchAll(
    /^import\s+(type\s+)?([^;]*?)\s+from\s+['"][^'"]+['"]/gm,
  )

  for (const [, typeOnly, clause] of statements) {
    if (typeOnly) {
      continue
    }

    const braces = /\{([^}]*)\}/.exec(clause)
    const defaultOrNamespace = clause.replace(/\{[^}]*\}/, '')

    for (const part of defaultOrNamespace.split(',')) {
      const local = part.replace(/^\s*\*\s+as\s+/, '').trim()

      if (local) {
        names.add(local)
      }
    }

    for (const specifier of braces?.[1].split(',') ?? []) {
      const trimmed = specifier.trim()

      if (!trimmed || trimmed.startsWith('type ')) {
        continue
      }

      const alias = / as (\w+)$/.exec(trimmed)
      names.add(alias ? alias[1] : trimmed)
    }
  }

  return names
}

/**
 * True when `name` is bound at the top level of `source`: imported under
 * that local name, or declared (optionally exported) with
 * `const`/`let`/`var`/`function` at column zero. A custom server file that already wires auth keeps its own bindings.
 */
export function hasBinding(source: string, name: string): boolean {
  const declared = new RegExp(
    `^(?:export\\s+)?(?:const|let|var|function)\\s+${name}\\b`,
    'm',
  )

  return importedBindings(source).has(name) || declared.test(source)
}

interface ImportSpec {
  names: string[]
  from: string
}

interface ServerImport {
  line: string
  from: string
}

/**
 * The import statements the registration needs, minus any name `source`
 * already binds, each with the module it imports from.
 */
export function uploadsServerImports(
  source: string,
  auth: UploadsServerAuth | null,
): ServerImport[] {
  const specs: ImportSpec[] = []

  if (auth) {
    if (auth.usesFactory) {
      // With `authDecoder` already declared there is nothing to build it from
      if (!hasBinding(source, 'authDecoder')) {
        specs.push({
          names: ['createAuthDecoder'],
          from: auth.decoderPackage,
        })
      }
    } else {
      specs.push({ names: ['authDecoder'], from: auth.decoderPackage })
    }
  }

  specs.push({
    names: auth
      ? ['cedarUploadsPlugin', 'createUploadAuthenticator']
      : ['cedarUploadsPlugin'],
    from: '@cedarjs/uploads',
  })

  if (auth) {
    const authNames = ['getCurrentUser']

    if (auth.usesFactory && !hasBinding(source, 'authDecoder')) {
      authNames.unshift('cookieName')
    }

    specs.push({ names: authNames, from: 'src/lib/auth' })
  }

  specs.push({ names: ['db'], from: 'src/lib/db' })
  specs.push({ names: ['targets'], from: 'src/lib/uploads' })

  return specs
    .map((spec) => ({
      ...spec,
      names: spec.names.filter((name) => !hasBinding(source, name)),
    }))
    .filter((spec) => spec.names.length > 0)
    .map((spec) => ({
      line: `import { ${spec.names.join(', ')} } from '${spec.from}'`,
      from: spec.from,
    }))
}

interface ImportStatement {
  /** Index of the statement's first line */
  start: number
  /** Index of the statement's last line */
  end: number
  from: string
}

/**
 * Top-level import statements in `lines`, including ones that span several
 * lines.
 */
function findImports(lines: string[]): ImportStatement[] {
  const imports: ImportStatement[] = []

  for (let start = 0; start < lines.length; start++) {
    if (!/^import\b/.test(lines[start])) {
      continue
    }

    const sideEffect = /^import\s*['"]([^'"]+)['"]/.exec(lines[start])

    if (sideEffect) {
      imports.push({ start, end: start, from: sideEffect[1] })
      continue
    }

    for (let end = start; end < lines.length; end++) {
      const from = /\bfrom\s*['"]([^'"]+)['"]/.exec(lines[end])

      if (from) {
        imports.push({ start, end, from: from[1] })
        start = end
        break
      }
    }
  }

  return imports
}

/**
 * The rank of an import's group in the `import-x/order` config of
 * `@cedarjs/eslint-config`: builtins, `react`, other packages, `@cedarjs/`
 * packages, `src/` modules matched by the services/directives/sdl path
 * group, other `src/` modules, then parent, sibling, and index imports.
 */
function importGroup(from: string): number {
  if (isBuiltin(from)) {
    return 0
  }

  if (from === 'react') {
    return 1
  }

  if (from.startsWith('@cedarjs/')) {
    return 3
  }

  if (from.startsWith('src/')) {
    return /^src\/[^/]+\/.+\.(?:sdl\.)?(?:js|ts)$/.test(from) ? 4 : 5
  }

  if (from === '..' || from.startsWith('../')) {
    return 6
  }

  if (/^\.\/?(?:index(?:\.[jt]sx?)?)?$/.test(from)) {
    return 8
  }

  if (from.startsWith('./')) {
    return 7
  }

  return 2
}

/**
 * Compares module specifiers the way `import-x/order`'s case-insensitive,
 * ascending `alphabetize` option does: segment by segment, with a path
 * sorting before a longer one that starts with the same segments.
 */
function compareSpecifiers(a: string, b: string): number {
  const segmentsA = a.toLowerCase().split('/')
  const segmentsB = b.toLowerCase().split('/')

  for (let i = 0; i < Math.min(segmentsA.length, segmentsB.length); i++) {
    if (segmentsA[i] !== segmentsB[i]) {
      return segmentsA[i] < segmentsB[i] ? -1 : 1
    }
  }

  return segmentsA.length - segmentsB.length
}

/**
 * Inserts `serverImport` where `import-x/order` expects it: alphabetically
 * within the imports of its group, or as a new group separated by blank
 * lines when the file has no imports of that group yet.
 */
function insertImport(lines: string[], serverImport: ServerImport): string[] {
  const imports = findImports(lines)
  const group = importGroup(serverImport.from)
  const sameGroup = imports.filter((i) => importGroup(i.from) === group)

  if (sameGroup.length > 0) {
    const next = sameGroup.find(
      (i) => compareSpecifiers(i.from, serverImport.from) > 0,
    )
    const at = next ? next.start : sameGroup[sameGroup.length - 1].end + 1

    return [...lines.slice(0, at), serverImport.line, ...lines.slice(at)]
  }

  const earlier = imports.filter((i) => importGroup(i.from) < group)

  if (earlier.length > 0) {
    const at = Math.max(...earlier.map((i) => i.end)) + 1
    const inserted = ['', serverImport.line]

    // Keeps a blank line between the new group and whatever follows it
    if (at < lines.length && lines[at].trim() !== '') {
      inserted.push('')
    }

    return [...lines.slice(0, at), ...inserted, ...lines.slice(at)]
  }

  const later = imports.find((i) => importGroup(i.from) > group)
  const at = later ? later.start : 0

  return [...lines.slice(0, at), serverImport.line, '', ...lines.slice(at)]
}

export function uploadsServerRegistration(
  source: string,
  auth: UploadsServerAuth | null,
) {
  if (!auth) {
    return `  await server.register(cedarUploadsPlugin, {
    tokenSecret: process.env.UPLOAD_TOKEN_SECRET,
    targets,
    db,
    // Once the app has auth, bind upload tokens to the logged-in user:
    //
    //   authenticate: createUploadAuthenticator({ authDecoder, getCurrentUser }),
  })
`
  }

  const decoder =
    auth.usesFactory && !hasBinding(source, 'authDecoder')
      ? '  const authDecoder = createAuthDecoder(cookieName)\n\n'
      : ''

  return `${decoder}  await server.register(cedarUploadsPlugin, {
    tokenSecret: process.env.UPLOAD_TOKEN_SECRET,
    targets,
    db,
    // Binds upload tokens to the logged-in user through the same auth
    // pipeline the GraphQL server uses
    authenticate: createUploadAuthenticator({ authDecoder, getCurrentUser }),
  })
`
}

/**
 * True when the server file already registers the plugin. The call must be
 * the statement on its line, optionally preceded by `await`, `void`, or a
 * variable declaration, which excludes commented-out registrations and
 * mentions inside strings.
 */
export function hasUploadsPlugin(source: string): boolean {
  return /^[ \t]*(?:(?:await|void)\s+|(?:const|let|var)\s+\w+\s*=\s*)?[\w.]+\.register\(\s*cedarUploadsPlugin\b/m.test(
    source,
  )
}

export function addUploadsPlugin(
  source: string,
  { auth = null }: { auth?: UploadsServerAuth | null } = {},
): string {
  if (hasUploadsPlugin(source)) {
    return source
  }

  const start = START_LINE.exec(source)

  if (!start) {
    throw new Error('CEDAR_UPLOADS_ERR_NO_START')
  }

  const withImports = uploadsServerImports(source, auth)
    .reduce(insertImport, source.split('\n'))
    .join('\n')

  return withImports.replace(
    START_LINE,
    (line) => `${uploadsServerRegistration(source, auth)}\n${line}`,
  )
}
