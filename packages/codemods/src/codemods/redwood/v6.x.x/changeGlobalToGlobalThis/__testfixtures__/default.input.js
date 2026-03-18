import { Link, routes } from '@cedarjs/router'
import { MetaTags } from '@cedarjs/web'

const HomePage = () => {
  console.log(global)

  return (
    <>
      <MetaTags title="Home" description="Home page" />

      <h1>HomePage</h1>
      <p>
        Find me in <code>./web/src/pages/HomePage/HomePage.tsx</code>
      </p>
      {/*
        My default route is named <code>home</code>, link to me with `
        <Link to={routes.home()}>Home</Link>`
      */}
    </>
  )
}

export default HomePage
