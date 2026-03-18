import { Link, routes } from '@cedarjs/router'
import { MetaTags } from '@cedarjs/web'

const TestPage = () => {
  return (
    <>
      <MetaTags title="Test" description="Test page" />

      <h1>TestPage</h1>
      <p>
        Find me in <code>./web/src/pages/TestPage/TestPage.js</code>
      </p>
      {/*
        My default route is named <code>test</code>, link to me with `
        <Link to={routes.test()}>Test</Link>`
      */}
    </>
  )
}

export default TestPage
