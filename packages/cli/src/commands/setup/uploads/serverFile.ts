/**
 * Plain-text editing of `api/src/server.ts` for `cedar setup uploads`: adds
 * the imports the upload plugin needs and registers it right before the
 * server starts. Throws `CEDAR_UPLOADS_ERR_NO_START` when the file has no
 * `await server.start()` line to anchor on, and returns the source unchanged
 * when the plugin is already registered.
 */

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
 * that local name, or declared with `const`/`let`/`var`/`function` at column
 * zero. A custom server file that already wires auth keeps its own bindings.
 */
export function hasBinding(source: string, name: string): boolean {
  const declared = new RegExp(`^(?:const|let|var|function)\\s+${name}\\b`, 'm')

  return importedBindings(source).has(name) || declared.test(source)
}

interface ImportSpec {
  names: string[]
  from: string
}

/**
 * The import lines the registration needs, minus any name `source` already
 * binds. Package imports come first, then `src/` imports, separated by a
 * blank line, matching the layout of a generated server file.
 */
export function uploadsServerImports(
  source: string,
  auth: UploadsServerAuth | null,
): string[] {
  const packageSpecs: ImportSpec[] = []
  const srcSpecs: ImportSpec[] = []

  if (auth) {
    if (auth.usesFactory) {
      // With `authDecoder` already declared there is nothing to build it from
      if (!hasBinding(source, 'authDecoder')) {
        packageSpecs.push({
          names: ['createAuthDecoder'],
          from: auth.decoderPackage,
        })
      }
    } else {
      packageSpecs.push({ names: ['authDecoder'], from: auth.decoderPackage })
    }
  }

  packageSpecs.push({
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

    srcSpecs.push({ names: authNames, from: 'src/lib/auth' })
  }

  srcSpecs.push({ names: ['db'], from: 'src/lib/db' })
  srcSpecs.push({ names: ['targets'], from: 'src/lib/uploads' })

  const render = (specs: ImportSpec[]) =>
    specs
      .map((spec) => ({
        ...spec,
        names: spec.names.filter((name) => !hasBinding(source, name)),
      }))
      .filter((spec) => spec.names.length > 0)
      .map((spec) => `import { ${spec.names.join(', ')} } from '${spec.from}'`)

  const packageLines = render(packageSpecs)
  const srcLines = render(srcSpecs)

  if (packageLines.length > 0 && srcLines.length > 0) {
    return [...packageLines, '', ...srcLines]
  }

  return [...packageLines, ...srcLines]
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

/** True when the server file already registers the plugin. */
export function hasUploadsPlugin(source: string): boolean {
  return /\.register\(\s*cedarUploadsPlugin\b/.test(source)
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

  const lines = source.split('\n')
  let lastImport = -1

  for (const [index, line] of lines.entries()) {
    if (/^import\s/.test(line)) {
      lastImport = index
    }
  }

  const withImports = [
    ...lines.slice(0, lastImport + 1),
    ...uploadsServerImports(source, auth),
    ...lines.slice(lastImport + 1),
  ].join('\n')

  return withImports.replace(
    START_LINE,
    (line) => `${uploadsServerRegistration(source, auth)}\n${line}`,
  )
}
