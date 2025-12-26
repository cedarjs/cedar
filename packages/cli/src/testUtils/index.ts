import { format } from 'prettier'
import parserBabel from 'prettier/parser-babel'

export const formatCode = async (code: string) => {
  return format(code, {
    parser: 'babel-ts',
    // @ts-expect-error - TS is picking up @types/babel, which is outdated.
    // We have it because babel-plugin-tester pulls it in
    plugins: [parserBabel],
  })
}
