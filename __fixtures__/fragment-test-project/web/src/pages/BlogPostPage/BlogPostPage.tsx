// import { Link, routes } from '@cedarjs/router'
import { Metadata } from '@cedarjs/web'

type BlogPostPageProps = {
  id: number
}

import BlogPostCell from 'src/components/BlogPostCell'

const BlogPostPage = ({ id }: BlogPostPageProps) => {
  return (
    <>
      <Metadata title={`Post ${id}`} description={`Description ${id}`} og />

      <BlogPostCell id={id} />
    </>
  )
}
export default BlogPostPage
