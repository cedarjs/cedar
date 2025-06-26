export default `
import { Link, routes } from '@cedarjs/router'

const HomePage = () => {
  return (

    <>
      <header>
        <h1>Cedar Blog</h1>
        <nav>
          <ul>
            <li>
              <Link to={routes.about()}>About</Link>
            </li>
          </ul>
        </nav>
      </header>
      <main>Home</main>
    </>
  )
}

export default HomePage`
