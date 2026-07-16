/**
 * Injects imports `gql` from `graphql-tag` and `context` from `@cedarjs/context`
 * into API source files that reference those identifiers without importing them.
 *
 * This replaces `babel-plugin-auto-import` for the esbuild API build path,
 * matching the behavior of `cedarAutoImportsPlugin` in Vite builds.
 */

const IMPORT_GQL = "import gql from 'graphql-tag'\n"
const IMPORT_CONTEXT = "import { context } from '@cedarjs/context'\n"

export function applyAutoImports(code: string): string {
  let result = code

  if (
    /\bgql\b/.test(code) &&
    !/import\s+(?:\{?\s*gql\s*\}?|[*]|default).*?['"]graphql-tag['"]/.test(code)
  ) {
    result = IMPORT_GQL + result
  }

  if (
    /\bcontext\b/.test(code) &&
    !/import\s+(?:\{?\s*context\s*\}?).*?['"]@cedarjs\/context['"]/.test(code)
  ) {
    result = IMPORT_CONTEXT + result
  }

  return result
}
