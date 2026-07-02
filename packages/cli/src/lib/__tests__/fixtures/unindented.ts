// Unindent the provided (maybe multiline) string such that the first line has an indent of 0
// and all subsequent lines maintain their relative indentation level to the first line.
export const unindented = (code: string): string => {
  const firstLineIndent = code.length - code.trimStart().length
  return code.replace(new RegExp(`^( {${firstLineIndent}})`, 'gm'), '')
}
