import { format } from 'prettier'
import parserBabel from 'prettier/parser-babel'

export const formatCode = async (code: string) => {
  return format(code, {
    parser: 'babel-ts',
    plugins: [parserBabel],
  })
}
