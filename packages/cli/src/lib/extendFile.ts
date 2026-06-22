import fs from 'node:fs'

/**
 * Convenience function to check if a file includes a particular string.
 * @param filePath File to read and search for str.
 * @param str The value to search for.
 * @returns true if the file exists and the contents thereof include the given string, else false.
 */
export function fileIncludes(filePath: string, str: string): boolean {
  return (
    fs.existsSync(filePath) &&
    fs.readFileSync(filePath).toString().includes(str)
  )
}

interface InsertComponentConfig {
  name?: string
  props?: Record<string, unknown> | string
  around?: string
  within?: string
  insertBefore?: string
  insertAfter?: string
}

interface ExtendJSXFileOptions {
  insertComponent: InsertComponentConfig
  imports?: string[]
  moduleScopeLines?: string[]
}

/**
 * Inject code into the file at the given path.
 * Use of insertComponent assumes only one of (around|within) is used, and that the component
 * identified by (around|within) occurs exactly once in the file at the given path.
 * Imports are added after the last redwoodjs import.
 * moduleScopeLines are added after the last import.
 *
 * @param filePath Path to JSX file to extend.
 * @param options Configure behavior
 * @returns Nothing; writes changes directly into the file at the given path.
 */
export function extendJSXFile(
  filePath: string,
  {
    insertComponent: {
      name = undefined,
      props = undefined,
      around = undefined,
      within = undefined,
      insertBefore = undefined,
      insertAfter = undefined,
    },
    imports = [],
    moduleScopeLines = [],
  }: ExtendJSXFileOptions,
): void {
  const content = fs.readFileSync(filePath).toString().split('\n')

  if (moduleScopeLines?.length) {
    content.splice(
      content.findLastIndex((l) => l.trimStart().startsWith('import')) + 1,
      0,
      '', // Empty string to add a newline when we .join('\n') below.
      ...moduleScopeLines,
    )
  }

  if (imports?.length) {
    content.splice(
      content.findLastIndex((l) => l.includes('@cedarjs')) + 1,
      0,
      '', // Empty string to add a newline when we .join('\n') below.
      ...imports,
    )
  }

  if (name) {
    insertComponent(content, {
      component: name,
      props,
      around,
      within,
      insertBefore,
      insertAfter,
    })
  }

  fs.writeFileSync(filePath, content.filter((e) => e !== undefined).join('\n'))
}

interface InternalInsertComponentConfig {
  component: string
  props?: Record<string, unknown> | string
  around?: string
  within?: string
  insertBefore?: string
  insertAfter?: string
}

/**
 * Inject lines of code into an array of lines to wrap the specified component in a new component tag.
 * Increases the indentation of newly-wrapped content by two spaces (one tab).
 *
 * @param content A JSX file split by newlines.
 * @param config Component insertion configuration.
 * @returns Nothing; modifies content in place.
 */
function insertComponent(
  content: string[],
  {
    component,
    props,
    around,
    within,
    insertBefore,
    insertAfter,
  }: InternalInsertComponentConfig,
): void {
  if ((around && within) || !(around || within)) {
    throw new Error(
      'Exactly one of (around | within) must be defined. Choose one.',
    )
  }

  const target = around ?? within
  const findTagIndex = (regex: RegExp) =>
    content.findIndex((line) => regex.test(line))

  let open = findTagIndex(new RegExp(`([^\\S\r\n]*)<${target}\\s*(.*)\\s*>`))
  let close = findTagIndex(new RegExp(`([^\\S\r\n]*)<\/${target}>`)) + 1

  if (open === -1 || close === -1) {
    throw new Error(`Could not find tags for ${target}`)
  }

  if (within) {
    open++
    close--
  }

  // Assuming close line has same indent depth.
  // The regex always matches (.*) can be empty), so the result is never null.
  const depthMatch = content[open].match(/([^\S\r\n]*).*/)
  const componentDepth = depthMatch?.[1] ?? ''

  content.splice(
    open,
    close - open, // "Delete" the wrapped component contents. We put it back below.
    insertBefore ? componentDepth + insertBefore : undefined,
    componentDepth + buildOpeningTag(component, props),
    // Increase indent of each now-nested tag by one tab (two spaces)
    ...content.slice(open, close).map((line) => '  ' + line),
    componentDepth + `</${component}>`,
    insertAfter ? componentDepth + insertAfter : undefined,
  )
}

/**
 * @param componentName Name of the component to create a tag for.
 * @param props Properties object, or string, to pass to the tag.
 * @returns A string containing a valid JSX opening tag.
 */
function buildOpeningTag(
  componentName: string,
  props: Record<string, unknown> | string | undefined,
): string {
  const propsString = (() => {
    switch (typeof props) {
      case 'undefined':
        return ''
      case 'object':
        return objectToComponentProps(props, { raw: true }).join(' ')
      case 'string':
        return props
      default:
        throw new Error(
          `Illegal argument passed for 'props'. Required: {Object | string | undefined}, got ${typeof props}`,
        )
    }
  })()

  const possibleSpace = propsString.length ? ' ' : ''
  return `<${componentName}${possibleSpace}${propsString}>`
}

/**
 * Transform an object to JSX props syntax
 *
 * @param obj
 * @param options
 * @returns
 */
export function objectToComponentProps(
  obj: Record<string, unknown>,
  options: { exclude?: string[]; raw?: boolean | string[] } = {
    exclude: [],
    raw: false,
  },
): string[] {
  const props: string[] = []

  const doRaw = (key: string) =>
    options.raw === true ||
    (Array.isArray(options.raw) && options.raw.includes(key))

  for (const [key, value] of Object.entries(obj)) {
    if (options.exclude?.includes(key)) {
      continue
    }
    if (doRaw(key)) {
      props.push(`${key}={${value}}`)
    } else {
      props.push(`${key}="${value}"`)
    }
  }

  return props
}
