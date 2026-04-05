// import { Link, routes } from '@cedarjs/router'
import { Metadata } from '@cedarjs/web'

const LiveQueryPage = () => {
  return (
    <>
      <Metadata title="LiveQuery" description="LiveQuery page" />

      <h1>LiveQueryPage</h1>
      <p>
        Find me in <code>./web/src/pages/LiveQueryPage/LiveQueryPage.tsx</code>
      </p>
      {/*
          My default route is named `liveQuery`, link to me with:
          `<Link to={routes.liveQuery()}>LiveQuery</Link>`
      */}
    </>
  )
}

export default LiveQueryPage
