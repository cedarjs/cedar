import tsEslintParser from '@typescript-eslint/parser'
import { RuleTester } from '@typescript-eslint/rule-tester'

import { cellTypeAnnotations } from '../cell-type-annotations.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsEslintParser,
    parserOptions: {
      ecmaVersion: 'latest',
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
})

const CELL_FILENAME = '/app/web/src/components/BlogPostCell/BlogPostCell.tsx'

ruleTester.run('cell-type-annotations', cellTypeAnnotations, {
  valid: [
    {
      // Not a Cell file (no `Cell` filename suffix, no QUERY/FRAGMENT +
      // Success exports), so unannotated exports are ignored.
      filename: '/app/web/src/components/BlogPostForm/BlogPostForm.tsx',
      code: `
        export const beforeQuery = (props) => {
          return { variables: props }
        }
      `,
    },
    {
      // Has QUERY + Success exports, but the filename doesn't end in
      // `Cell.tsx` -- both signals are required, so this isn't treated as a
      // Cell and unannotated exports are ignored.
      filename: '/app/web/src/components/BlogPostsList/BlogPostsList.tsx',
      code: `
        import type { CellSuccessProps } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`

        export const beforeQuery = (props) => {
          return { variables: props }
        }

        export const Success = ({ blogPosts }: CellSuccessProps) => (
          <div>{blogPosts.length}</div>
        )
      `,
    },
    {
      // `.jsx` Cells are plain JavaScript-project output with no build step
      // that strips TypeScript syntax, so they're never treated as Cells by
      // this rule, even with the filename suffix and both exports present.
      filename: '/app/web/src/components/BlogPostCell/BlogPostCell.jsx',
      code: `
        export const QUERY = gql\`query { blogPosts { id } }\`

        export const beforeQuery = (props) => {
          return { variables: props }
        }

        export const Success = ({ blogPosts }) => (
          <div>{blogPosts.length}</div>
        )
      `,
    },
    {
      filename: CELL_FILENAME,
      code: `
        import type {
          CellBeforeQueryResult,
          CellFailureProps,
          CellSuccessProps,
          TypedDocumentNode,
        } from '@cedarjs/web'
        import type { FindBlogPost, FindBlogPostVariables } from 'types/graphql'

        export const QUERY: TypedDocumentNode<
          FindBlogPost,
          FindBlogPostVariables
        > = gql\`
          query FindBlogPost($id: Int!) {
            blogPost(id: $id) {
              id
            }
          }
        \`

        export const beforeQuery = (
          props: FindBlogPostVariables,
        ): CellBeforeQueryResult<FindBlogPostVariables> => {
          return { variables: props }
        }

        export const Failure = ({
          error,
        }: CellFailureProps<FindBlogPostVariables>) => (
          <div>{error?.message}</div>
        )

        export const Success = ({
          blogPost,
        }: CellSuccessProps<FindBlogPost, FindBlogPostVariables>) => {
          return <div>{blogPost.id}</div>
        }
      `,
    },
    {
      // `Loading` with no props at all doesn't need annotating.
      filename: CELL_FILENAME,
      code: `
        import type { CellSuccessProps } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`
        export const Loading = () => <div>Loading...</div>
        export const Success = ({ blogPosts }: CellSuccessProps) => (
          <div>{blogPosts.length}</div>
        )
      `,
    },
  ],
  invalid: [
    {
      // beforeQuery's return type is derived from QUERY's TypedDocumentNode
      // variables type, and there's no existing `@cedarjs/web` type import.
      filename: CELL_FILENAME,
      code: `
        import type { FindBlogPost, FindBlogPostVariables } from 'types/graphql'

        export const QUERY: TypedDocumentNode<
          FindBlogPost,
          FindBlogPostVariables
        > = gql\`
          query FindBlogPost($id: Int!) {
            blogPost(id: $id) {
              id
            }
          }
        \`

        export const beforeQuery = (props: FindBlogPostVariables) => {
          return { variables: props }
        }

        export const Success = () => <div>Success</div>
      `,
      output: `import type { CellBeforeQueryResult } from '@cedarjs/web'

        import type { FindBlogPost, FindBlogPostVariables } from 'types/graphql'

        export const QUERY: TypedDocumentNode<
          FindBlogPost,
          FindBlogPostVariables
        > = gql\`
          query FindBlogPost($id: Int!) {
            blogPost(id: $id) {
              id
            }
          }
        \`

        export const beforeQuery = (props: FindBlogPostVariables): CellBeforeQueryResult<FindBlogPostVariables> => {
          return { variables: props }
        }

        export const Success = () => <div>Success</div>
      `,
      errors: [
        {
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'beforeQuery',
            typeName: 'CellBeforeQueryResult<FindBlogPostVariables>',
            kind: 'function',
            location: 'return type',
          },
        },
      ],
    },
    {
      // No QUERY typing to derive from -- falls back to a safe default.
      filename: CELL_FILENAME,
      code: `
        export const QUERY = gql\`query { blogPosts { id } }\`

        export const beforeQuery = (props) => {
          return { variables: props }
        }

        export const Success = () => <div>Success</div>
      `,
      output: `import type { CellBeforeQueryResult } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`

        export const beforeQuery = (props): CellBeforeQueryResult<Record<string, unknown>> => {
          return { variables: props }
        }

        export const Success = () => <div>Success</div>
      `,
      errors: [
        {
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'beforeQuery',
            typeName: 'CellBeforeQueryResult<Record<string, unknown>>',
            kind: 'function',
            location: 'return type',
          },
        },
        { messageId: 'beforeQueryParamNeedsType' },
      ],
    },
    {
      // Return type present, but the (load-bearing) param type is missing --
      // reported without an autofix.
      filename: CELL_FILENAME,
      code: `
        import type { CellBeforeQueryResult } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`

        export const beforeQuery = (props): CellBeforeQueryResult<Record<string, unknown>> => {
          return { variables: props }
        }

        export const Success = () => <div>Success</div>
      `,
      output: null,
      errors: [
        {
          messageId: 'beforeQueryParamNeedsType',
        },
      ],
    },
    {
      // `export function beforeQuery(...)` declaration form.
      filename: CELL_FILENAME,
      code: `
        export const QUERY = gql\`query { blogPosts { id } }\`

        export function beforeQuery(props) {
          return { variables: props }
        }

        export const Success = () => <div>Success</div>
      `,
      output: `import type { CellBeforeQueryResult } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`

        export function beforeQuery(props): CellBeforeQueryResult<Record<string, unknown>> {
          return { variables: props }
        }

        export const Success = () => <div>Success</div>
      `,
      errors: [
        {
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'beforeQuery',
            typeName: 'CellBeforeQueryResult<Record<string, unknown>>',
            kind: 'function',
            location: 'return type',
          },
        },
        { messageId: 'beforeQueryParamNeedsType' },
      ],
    },
    {
      // afterQuery -- both param and return type are always `DataObject`.
      // A single report covers both missing pieces.
      filename: CELL_FILENAME,
      code: `
        import type { CellSuccessProps } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`
        export const afterQuery = (data) => data
        export const Success = ({ blogPosts }: CellSuccessProps) => (
          <div>{blogPosts.length}</div>
        )
      `,
      output: `
        import type { CellSuccessProps, DataObject } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`
        export const afterQuery = (data: DataObject): DataObject => data
        export const Success = ({ blogPosts }: CellSuccessProps) => (
          <div>{blogPosts.length}</div>
        )
      `,
      errors: [
        {
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'afterQuery',
            typeName: 'DataObject',
            kind: 'function',
            location: 'parameter and return type',
          },
        },
      ],
    },
    {
      // isEmpty's return type is always `boolean` -- no import needed.
      filename: CELL_FILENAME,
      code: `
        import type { CellSuccessProps, DataObject } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`
        export const isEmpty = (response: DataObject, { isDataEmpty }: { isDataEmpty: (data: DataObject) => boolean }) => {
          return isDataEmpty(response)
        }
        export const Success = ({ blogPosts }: CellSuccessProps) => (
          <div>{blogPosts.length}</div>
        )
      `,
      output: `
        import type { CellSuccessProps, DataObject } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`
        export const isEmpty = (response: DataObject, { isDataEmpty }: { isDataEmpty: (data: DataObject) => boolean }): boolean => {
          return isDataEmpty(response)
        }
        export const Success = ({ blogPosts }: CellSuccessProps) => (
          <div>{blogPosts.length}</div>
        )
      `,
      errors: [
        {
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'isEmpty',
            typeName: 'boolean',
            kind: 'function',
            location: 'return type',
          },
        },
      ],
    },
    {
      // Failure's props type, derived from QUERY's variables type.
      filename: CELL_FILENAME,
      code: `
        import type { CellSuccessProps } from '@cedarjs/web'
        import type { FindBlogPost, FindBlogPostVariables } from 'types/graphql'

        export const QUERY: TypedDocumentNode<
          FindBlogPost,
          FindBlogPostVariables
        > = gql\`
          query FindBlogPost($id: Int!) {
            blogPost(id: $id) {
              id
            }
          }
        \`

        export const Failure = ({ error }) => <div>{error?.message}</div>
        export const Success = ({ blogPost }: CellSuccessProps) => (
          <div>{blogPost.id}</div>
        )
      `,
      output: `
        import type { CellSuccessProps, CellFailureProps } from '@cedarjs/web'
        import type { FindBlogPost, FindBlogPostVariables } from 'types/graphql'

        export const QUERY: TypedDocumentNode<
          FindBlogPost,
          FindBlogPostVariables
        > = gql\`
          query FindBlogPost($id: Int!) {
            blogPost(id: $id) {
              id
            }
          }
        \`

        export const Failure = ({ error }: CellFailureProps<FindBlogPostVariables>) => <div>{error?.message}</div>
        export const Success = ({ blogPost }: CellSuccessProps) => (
          <div>{blogPost.id}</div>
        )
      `,
      errors: [
        {
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'Failure',
            typeName: 'CellFailureProps<FindBlogPostVariables>',
            kind: 'component',
            location: 'parameter',
          },
        },
      ],
    },
    {
      // `export function Success(...)` declaration form, and an existing
      // `@cedarjs/web` type import that the fix appends to.
      filename: CELL_FILENAME,
      code: `
        import type { CellFailureProps } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`

        export function Success({ blogPosts }) {
          return <div>{blogPosts.length}</div>
        }
      `,
      output: `
        import type { CellFailureProps, CellSuccessProps } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`

        export function Success({ blogPosts }: CellSuccessProps) {
          return <div>{blogPosts.length}</div>
        }
      `,
      errors: [
        {
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'Success',
            typeName: 'CellSuccessProps',
            kind: 'component',
            location: 'parameter',
          },
        },
      ],
    },
    {
      // Unparenthesized single-param arrow: both the param and return type are
      // missing, so the fix has to wrap the param in parens itself rather than
      // anchoring on an existing `)`.
      filename: CELL_FILENAME,
      code: `
        export const QUERY = gql\`query { blogPosts { id } }\`

        export const afterQuery = data => data

        export const Success = () => <div>Success</div>
      `,
      output: `import type { DataObject } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`

        export const afterQuery = (data: DataObject): DataObject => data

        export const Success = () => <div>Success</div>
      `,
      errors: [
        {
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'afterQuery',
            typeName: 'DataObject',
            kind: 'function',
            location: 'parameter and return type',
          },
        },
      ],
    },
    {
      // Unparenthesized single-param arrow on a render prop: only the param
      // needs wrapping (no return type involved).
      filename: CELL_FILENAME,
      code: `
        export const QUERY = gql\`query { blogPosts { id } }\`

        export const Success = props => <div>{props.blogPosts.length}</div>
      `,
      output: `import type { CellSuccessProps } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`

        export const Success = (props: CellSuccessProps) => <div>{props.blogPosts.length}</div>
      `,
      errors: [
        {
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'Success',
            typeName: 'CellSuccessProps',
            kind: 'component',
            location: 'parameter',
          },
        },
      ],
    },
    {
      // Inline `import { type X }` specifiers count as already imported --
      // the fix must not add a second, duplicate import for the same name.
      filename: CELL_FILENAME,
      code: `
        import { type CellSuccessProps } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`

        export const Success = ({ blogPosts }) => (
          <div>{blogPosts.length}</div>
        )
      `,
      output: `
        import { type CellSuccessProps } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`

        export const Success = ({ blogPosts }: CellSuccessProps) => (
          <div>{blogPosts.length}</div>
        )
      `,
      errors: [
        {
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'Success',
            typeName: 'CellSuccessProps',
            kind: 'component',
            location: 'parameter',
          },
        },
      ],
    },
    {
      // A `@cedarjs/web` type import with no named specifier (a namespace
      // import here) has nothing to append to -- the fix must fall back to
      // inserting a new `import type` line instead of crashing.
      filename: CELL_FILENAME,
      code: `
        import type * as Web from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`

        export const Success = ({ blogPosts }) => (
          <div>{blogPosts.length}</div>
        )
      `,
      output: `import type { CellSuccessProps } from '@cedarjs/web'

        import type * as Web from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`

        export const Success = ({ blogPosts }: CellSuccessProps) => (
          <div>{blogPosts.length}</div>
        )
      `,
      errors: [
        {
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'Success',
            typeName: 'CellSuccessProps',
            kind: 'component',
            location: 'parameter',
          },
        },
      ],
    },
    {
      // `Loading`'s props type, derived from QUERY's variables type.
      filename: CELL_FILENAME,
      code: `
        import type { CellSuccessProps } from '@cedarjs/web'
        import type { FindBlogPost, FindBlogPostVariables } from 'types/graphql'

        export const QUERY: TypedDocumentNode<
          FindBlogPost,
          FindBlogPostVariables
        > = gql\`
          query FindBlogPost($id: Int!) {
            blogPost(id: $id) {
              id
            }
          }
        \`

        export const Loading = ({ id }) => <div>Loading {id}...</div>
        export const Success = ({ blogPost }: CellSuccessProps) => (
          <div>{blogPost.id}</div>
        )
      `,
      output: `
        import type { CellSuccessProps, CellLoadingProps } from '@cedarjs/web'
        import type { FindBlogPost, FindBlogPostVariables } from 'types/graphql'

        export const QUERY: TypedDocumentNode<
          FindBlogPost,
          FindBlogPostVariables
        > = gql\`
          query FindBlogPost($id: Int!) {
            blogPost(id: $id) {
              id
            }
          }
        \`

        export const Loading = ({ id }: CellLoadingProps<FindBlogPostVariables>) => <div>Loading {id}...</div>
        export const Success = ({ blogPost }: CellSuccessProps) => (
          <div>{blogPost.id}</div>
        )
      `,
      errors: [
        {
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'Loading',
            typeName: 'CellLoadingProps<FindBlogPostVariables>',
            kind: 'component',
            location: 'parameter',
          },
        },
      ],
    },
    {
      // isEmpty with untyped response and options params but an already
      // typed return -- the message and fix should only cover the params.
      filename: CELL_FILENAME,
      code: `
        import type { CellSuccessProps, DataObject } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`
        export const isEmpty = (response, { isDataEmpty }): boolean => {
          return isDataEmpty(response)
        }
        export const Success = ({ blogPosts }: CellSuccessProps) => (
          <div>{blogPosts.length}</div>
        )
      `,
      output: `
        import type { CellSuccessProps, DataObject } from '@cedarjs/web'

        export const QUERY = gql\`query { blogPosts { id } }\`
        export const isEmpty = (response: DataObject, { isDataEmpty }: { isDataEmpty: (data: DataObject) => boolean }): boolean => {
          return isDataEmpty(response)
        }
        export const Success = ({ blogPosts }: CellSuccessProps) => (
          <div>{blogPosts.length}</div>
        )
      `,
      errors: [
        {
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'isEmpty',
            typeName: 'DataObject',
            kind: 'function',
            location: 'parameters',
          },
        },
      ],
    },
    {
      // Cell detection via a `FRAGMENT` export instead of `QUERY`.
      filename: CELL_FILENAME,
      code: `
        import type { CellSuccessProps } from '@cedarjs/web'

        export const FRAGMENT = gql\`
          fragment BlogPostCell_post on Post {
            id
            title
          }
        \`

        export const afterQuery = (data) => data

        export const Success = ({ post }: CellSuccessProps) => (
          <div>{post.title}</div>
        )
      `,
      output: `
        import type { CellSuccessProps, DataObject } from '@cedarjs/web'

        export const FRAGMENT = gql\`
          fragment BlogPostCell_post on Post {
            id
            title
          }
        \`

        export const afterQuery = (data: DataObject): DataObject => data

        export const Success = ({ post }: CellSuccessProps) => (
          <div>{post.title}</div>
        )
      `,
      errors: [
        {
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'afterQuery',
            typeName: 'DataObject',
            kind: 'function',
            location: 'parameter and return type',
          },
        },
      ],
    },
  ],
})
