import type { ReactNode } from 'react'

interface Props {
  children?: ReactNode
}

/**
 * Invisible wrapper used as a workaround for multi-line MDX comments.
 *
 * Prettier's MDX parser mangles multi-line JSX comments by misreading the
 * asterisk delimiters as Markdown emphasis and normalising them to underscores.
 * Wrapping comment-only content in this component avoids the problem entirely:
 * Prettier treats the children as JSX and leaves them alone, while the
 * component itself renders nothing.
 *
 * Usage:
 *
 * ```mdx
 * <SourceComment>
 * Any multi-line content that should be invisible goes here.
 *
 * - lists
 * - code blocks
 * - raw HTML
 *
 * </SourceComment>
 * ```
 *
 * @see https://github.com/prettier/prettier/issues/15163#issuecomment-3753270604
 */
export default function SourceComment(_props: Props): null {
  return null
}
