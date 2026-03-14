// import { Link, routes } from '@cedarjs/router'

type WaterfallPageProps = {
  id: number
}

import WaterfallBlogPostCell from 'src/components/WaterfallBlogPostCell'

const WaterfallPage = ({ id }: WaterfallPageProps) => (
  <WaterfallBlogPostCell id={id} />
)

export default WaterfallPage
