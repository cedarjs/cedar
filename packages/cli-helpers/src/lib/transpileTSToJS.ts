import { transform } from 'sucrase'

const BLANK_LINE_REGEX = /^[ \t]*$/

/**
 * Strips the TypeScript syntax from `content` and returns the resulting
 * JavaScript source. Everything that is not TypeScript syntax, including JSX,
 * comments, blank lines and indentation, is kept byte-for-byte, so the output
 * only needs formatting.
 *
 * `import type` statements, `type` specifiers and imports whose bindings are
 * only used as types are removed. Lines that only held removed syntax (for
 * example an `import type` line or an `interface` body) are dropped so they
 * do not turn into stray blank lines.
 *
 * `filename` is used for error messages. The content is always parsed as TSX
 * because templates can contain JSX regardless of their extension.
 *
 * Throws when sucrase reports a syntax error.
 */
export function transpileTSToJS(filename: string, content: string) {
  let code: string

  try {
    code = transform(content, {
      // `jsx` is required to parse JSX at all. `jsxRuntime: 'preserve'` keeps
      // the JSX untouched so the project's own build compiles it.
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'preserve',
      // Keep modern ECMAScript syntax (optional chaining, class fields, ...)
      // as written.
      disableESTransforms: true,
      keepUnusedImports: false,
      filePath: filename,
    }).code
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)

    throw new Error(
      `Could not transform ${filename} from TypeScript to JavaScript:\n${message}`,
    )
  }

  return dropEmptiedLines(content, code)
}

/**
 * sucrase keeps every line break, so line number X of the output corresponds to
 * line X of the input. A line that is blank in the output but was not blank
 * in the input only contained TypeScript syntax and is removed.
 */
function dropEmptiedLines(input: string, output: string) {
  const inputLines = input.split('\n')
  const outputLines = output.split('\n')

  if (inputLines.length !== outputLines.length) {
    return output
  }

  return outputLines
    .filter(
      (line, index) =>
        !BLANK_LINE_REGEX.test(line) ||
        BLANK_LINE_REGEX.test(inputLines[index]),
    )
    .join('\n')
}
