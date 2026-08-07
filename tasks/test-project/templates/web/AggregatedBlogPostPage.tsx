import { Metadata } from '@cedarjs/web'

import AggregatedBlogPostCell from 'src/components/AggregatedBlogPostCell'

type AggregatedBlogPostPageProps = {
  id: number
}

const AggregatedBlogPostPage = ({ id }: AggregatedBlogPostPageProps) => {
  return (
    <>
      <Metadata title={`Aggregated Post ${id}`} />

      <AggregatedBlogPostCell id={id} />
    </>
  )
}

export default AggregatedBlogPostPage
