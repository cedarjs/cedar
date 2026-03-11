// import { Link, routes } from '@cedarjs/router'
import { Metadata } from '@cedarjs/web'

import BlogPostCell from 'src/components/BlogPostCell'

type BlogPostPageProps = {
  id: number
}

const BlogPostPage = ({ id }: BlogPostPageProps) => {
  return (
    <>
      <Metadata title={`Post ${id}`} description={`Description ${id}`} og />

      <BlogPostCell id={id} />
    </>
  )
}

export default BlogPostPage
