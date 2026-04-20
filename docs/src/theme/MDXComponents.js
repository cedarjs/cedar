import ShowForTs from '@site/src/components/ShowForTs'
import SourceComment from '@site/src/components/SourceComment'
import MDXComponents from '@theme-original/MDXComponents'

export default {
  // Re-use the default mapping.
  // See https://docusaurus.io/docs/markdown-features/react#mdx-component-scope
  ...MDXComponents,
  ShowForTs,
  SourceComment,
}
