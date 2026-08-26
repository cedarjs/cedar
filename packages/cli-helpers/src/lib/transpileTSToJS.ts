import path from 'node:path'

import ts from 'typescript'

const BLANK_LINE_MARKER = '//__CEDAR_TS_TO_JS_BLANK_LINE__'
const BLANK_LINE_REGEX = /^[ \t]*$/gm
const BLANK_LINE_MARKER_REGEX =
  /^[ \t]*\/\/__CEDAR_TS_TO_JS_BLANK_LINE__[ \t]*$/gm

const JSX_COMMENT_PLACEHOLDER = '__CEDAR_TS_TO_JS_JSX_COMMENT_'
const JSX_COMMENT_PLACEHOLDER_REGEX =
  /\{\s*'__CEDAR_TS_TO_JS_JSX_COMMENT_(\d+)__'\s*\}/g

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  // Keep JSX untouched. Generated .js/.jsx files contain JSX that the
  // project's own build compiles.
  jsx: ts.JsxEmit.Preserve,
  // Drop imports that are only used as types, including regular imports
  // whose bindings are never used as values.
  verbatimModuleSyntax: false,
  removeComments: false,
}

/**
 * Whether the emitter drops this statement entirely because it only carries
 * type information.
 */
function isTypeOnlyStatement(statement: ts.Statement) {
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement)
  ) {
    return true
  }

  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause

    if (!clause) {
      return false
    }

    if (clause.isTypeOnly) {
      return true
    }

    const bindings = clause.namedBindings

    return (
      !clause.name &&
      !!bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.length > 0 &&
      bindings.elements.every((element) => element.isTypeOnly)
    )
  }

  if (ts.isExportDeclaration(statement)) {
    return statement.isTypeOnly
  }

  const modifiers = ts.canHaveModifiers(statement)
    ? (ts.getModifiers(statement) ?? [])
    : []

  return modifiers.some(
    (modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword,
  )
}

/**
 * The emitter discards comments that sit above a type-only statement together
 * with the statement itself. This transformer moves such comments to the next
 * emitted statement so that, for example, a file-level comment above an
 * `interface` still ends up in the JavaScript output.
 */
const keepCommentsOfTypeOnlyStatements: ts.TransformerFactory<
  ts.SourceFile
> = () => {
  return (sourceFile) => {
    const text = sourceFile.getFullText()
    let pending: ts.CommentRange[] = []

    for (const statement of sourceFile.statements) {
      const ranges =
        ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? []

      if (isTypeOnlyStatement(statement)) {
        pending = [...pending, ...ranges]
        continue
      }

      if (pending.length === 0) {
        continue
      }

      ts.setEmitFlags(statement, ts.EmitFlags.NoLeadingComments)

      for (const range of [...pending, ...ranges]) {
        const raw = text.slice(range.pos, range.end)
        const body =
          range.kind === ts.SyntaxKind.SingleLineCommentTrivia
            ? raw.slice(2)
            : raw.slice(2, -2)

        ts.addSyntheticLeadingComment(statement, range.kind, body, true)
      }

      pending = []
    }

    return sourceFile
  }
}

/**
 * The emitter re-indents the lines of multi-line comments inside JSX
 * expressions (`{/* ... *\/}`). Such comments are swapped for a string
 * placeholder before transpiling and put back verbatim afterwards.
 */
function extractJsxComments(fileName: string, content: string) {
  const sourceFile = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  )

  const comments: string[] = []
  const replacements: { start: number; end: number; text: string }[] = []

  const visit = (node: ts.Node) => {
    if (ts.isJsxExpression(node) && !node.expression) {
      const index = comments.push(node.getText(sourceFile)) - 1

      replacements.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        text: `{'${JSX_COMMENT_PLACEHOLDER}${index}__'}`,
      })

      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  let result = content

  for (const replacement of replacements.reverse()) {
    result =
      result.slice(0, replacement.start) +
      replacement.text +
      result.slice(replacement.end)
  }

  return { content: result, comments }
}

function restoreJsxComments(content: string, comments: string[]) {
  return content.replace(
    JSX_COMMENT_PLACEHOLDER_REGEX,
    (_match, index: string) => comments[Number(index)],
  )
}

/**
 * Strips the TypeScript syntax from `content` and returns the resulting
 * JavaScript source. JSX is left untouched. Comments and blank lines are kept
 * where they are so the output only needs formatting.
 *
 * `filename` is used for error messages. The content is always parsed as TSX
 * because templates can contain JSX regardless of their extension.
 *
 * Throws when the TypeScript compiler reports a syntax error.
 */
export function transpileTSToJS(filename: string, content: string) {
  const fileName = path.basename(filename).replace(/\.tsx?$/, '') + '.tsx'

  // The TypeScript emitter does not keep blank lines, so every blank line is
  // swapped for a marker comment before transpiling and restored afterwards.
  // Comments survive the emitter (`removeComments: false`) and end up in the
  // same spot the blank line had.
  const withMarkers = content.replace(BLANK_LINE_REGEX, BLANK_LINE_MARKER)
  const { content: source, comments } = extractJsxComments(
    fileName,
    withMarkers,
  )

  const result = ts.transpileModule(source, {
    fileName,
    compilerOptions: COMPILER_OPTIONS,
    reportDiagnostics: true,
    transformers: { before: [keepCommentsOfTypeOnlyStatements] },
  })

  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  )

  if (errors.length > 0) {
    const details = errors
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      )
      .join('\n')

    throw new Error(
      `Could not transform ${filename} from TypeScript to JavaScript:\n${details}`,
    )
  }

  return restoreJsxComments(
    result.outputText.replace(BLANK_LINE_MARKER_REGEX, ''),
    comments,
  )
}
