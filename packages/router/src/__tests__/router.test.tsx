import React, { useEffect, useState } from 'react'

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import {
  beforeEach,
  describe,
  test,
  beforeAll,
  afterAll,
  expect,
  vi,
} from 'vitest'

import type { AuthContextInterface, UseAuth } from '@cedarjs/auth'

import type { GeneratedRoutesMap } from '../analyzeRoutes.js'
import {
  back,
  routes as generatedRoutes,
  Link,
  navigate,
  Private,
  PrivateSet,
  Redirect,
  Route,
  Router,
} from '../index.js'
import { useParams } from '../params.js'
import type { OrgProviderProps, Tenancy, UseOrg } from '../router-context.js'
import { Set } from '../Set.js'
import type { WrapperProps } from '../Set.js'

type UnknownAuthContextInterface = AuthContextInterface<
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown
>

// The types are generated in the user's project
const routes = generatedRoutes as GeneratedRoutesMap

function createDummyAuthContextValues(
  partial: Partial<UnknownAuthContextInterface>,
) {
  const authContextValues: UnknownAuthContextInterface = {
    loading: true,
    isAuthenticated: false,
    userMetadata: null,
    currentUser: null,
    logIn: async () => null,
    logOut: async () => null,
    signUp: async () => null,
    getToken: async () => null,
    getCurrentUser: async () => null,
    hasRole: () => false,
    hasUserRole: () => false,
    hasPermission: () => false,
    reauthenticate: async () => {},
    client: null,
    type: 'custom',
    hasError: false,
    forgotPassword: async () => null,
    resetPassword: async () => null,
    validateResetToken: async () => null,
    changePassword: async () => null,
  }

  return { ...authContextValues, ...partial }
}

interface MockAuth {
  isAuthenticated?: boolean
  loading?: boolean
  hasRole?: boolean | ((role: string[]) => boolean)
  loadingTimeMs?: number
}

const mockUseAuth =
  (
    {
      isAuthenticated = false,
      loading = false,
      hasRole = false,
      loadingTimeMs,
    }: MockAuth = {
      isAuthenticated: false,
      loading: false,
      hasRole: false,
    },
  ) =>
  () => {
    const [authLoading, setAuthLoading] = useState(loading)
    const [authIsAuthenticated, setAuthIsAuthenticated] =
      useState(isAuthenticated)

    useEffect(() => {
      let timer: NodeJS.Timeout | undefined
      if (loadingTimeMs) {
        timer = setTimeout(() => {
          setAuthLoading(false)
          setAuthIsAuthenticated(true)
        }, loadingTimeMs)
      }
      return () => {
        if (timer) {
          clearTimeout(timer)
        }
      }
    }, [])

    return createDummyAuthContextValues({
      loading: authLoading,
      isAuthenticated: authIsAuthenticated,
      hasRole: typeof hasRole === 'boolean' ? () => hasRole : hasRole,
    })
  }

const HomePage = () => <h1>Home Page</h1>
const LoginPage = () => <h1>Login Page</h1>
const AboutPage = () => <h1>About Page</h1>
const PrivatePage = () => <h1>Private Page</h1>
const RedirectPage = () => <Redirect to="/about" />
const NotFoundPage = () => <h1>404</h1>
const ParamPage = ({ value, q }: { value: string; q: string }) => {
  const params = useParams()

  return (
    <div>
      <p>param {`${value}${q}`}</p>
      <p>hookparams {`${params.value}?${params.q}`}</p>
    </div>
  )
}

beforeEach(() => {
  window.history.pushState({}, '', '/')
  Object.keys(routes).forEach((key) => delete routes[key])
})

describe('inits routes and navigates as expected', () => {
  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Route path="/about" page={AboutPage} name="about" />
      <Route path="/redirect" page={RedirectPage} name="redirect" />
      <Route path="/redirect2/{value}" redirect="/param-test/{value}" />
      <PrivateSet unauthenticated="home">
        <Route path="/private" page={PrivatePage} name="private" />
      </PrivateSet>
      <Route path="/param-test/{value}" page={ParamPage} name="params" />
      <Route notfound page={NotFoundPage} />
    </Router>
  )

  const getScreen = () => render(<TestRouter />)

  test('starts on home page', async () => {
    const screen = getScreen()
    await waitFor(() => screen.getByText(/Home Page/i))
  })

  test('navigate to about page', async () => {
    const screen = getScreen()
    act(() => navigate(routes.about()))
    await waitFor(() => screen.getByText(/About Page/i))
  })

  test('passes search params to the page', async () => {
    const screen = getScreen()
    act(() => navigate(routes.params({ value: 'val', q: 'q' })))
    await waitFor(() => {
      expect(screen.queryByText('param valq')).toBeInTheDocument()
      expect(screen.queryByText('hookparams val?q')).toBeInTheDocument()
    })
  })

  test('navigate to redirect page should redirect to about', async () => {
    const screen = getScreen()

    act(() => navigate(routes.redirect()))
    await waitFor(() => {
      expect(screen.queryByText(/Redirect Page/)).not.toBeInTheDocument()
      expect(screen.queryByText(/About Page/)).toBeInTheDocument()
    })
  })

  test('navigate to redirect2 should forward params', async () => {
    const screen = getScreen()

    await waitFor(() => screen.getByText(/Home Page/i))

    act(() => navigate('/redirect2/redirected?q=cue'))
    await waitFor(() => screen.getByText(/param redirectedcue/i))

    act(() => navigate('/redirect2/redirected'))
    await waitFor(() => screen.getByText(/param redirected/))
  })

  test('multiple navigates to params page should update params', async () => {
    const screen = getScreen()
    act(() => navigate(routes.params({ value: 'one' })))
    await waitFor(() => screen.getByText(/param one/i))

    act(() => navigate(routes.params({ value: 'two' })))
    await waitFor(() => screen.getByText(/param two/i))
  })

  test('notfound page catches undefined paths', async () => {
    const screen = getScreen()
    act(() => navigate('/no/route/defined'))
    await waitFor(() => screen.getByText('404'))
  })
})

describe('test params escaping', () => {
  const ParamPage = ({ value, q }: { value: string; q: string }) => {
    const params = useParams()

    return (
      <div>
        <p>param {`${value}${q}`}</p>
        <p>hookparams {`${params.value}?${params.q}`}</p>
      </div>
    )
  }

  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Route path="/redirect2/{value}" redirect="/param-test/{value}" />
      <Route path="/param-test/{value}" page={ParamPage} name="params" />
      <Route notfound page={NotFoundPage} />
    </Router>
  )

  const getScreen = () => render(<TestRouter />)

  test('Params with unreserved characters work in path and query', async () => {
    const screen = getScreen()
    act(() =>
      navigate(routes.params({ value: 'example.com', q: 'example.com' })),
    )
    await waitFor(() => {
      expect(
        screen.queryByText('param example.comexample.com'),
      ).toBeInTheDocument()
      expect(
        screen.queryByText('hookparams example.com?example.com'),
      ).toBeInTheDocument()
    })
  })

  test('Params with reserved characters work in path and query', async () => {
    const screen = getScreen()
    act(() =>
      navigate(routes.params({ value: 'example!com', q: 'example!com' })),
    )

    await waitFor(() => {
      expect(
        screen.queryByText('param example!comexample!com'),
      ).toBeInTheDocument()
      expect(
        screen.queryByText('hookparams example!com?example!com'),
      ).toBeInTheDocument()
    })
  })

  test('Params with unsafe characters work in query, are escaped in path', async () => {
    const screen = getScreen()
    act(() =>
      navigate(routes.params({ value: 'example com', q: 'example com' })),
    )

    await waitFor(() => {
      expect(
        screen.queryByText('param example%20comexample com'),
      ).toBeInTheDocument()
      expect(
        screen.queryByText('hookparams example%20com?example com'),
      ).toBeInTheDocument()
    })
  })

  test('Character / is valid as part of a param in query', async () => {
    const screen = getScreen()
    act(() => navigate(routes.params({ value: 'example', q: 'example/com' })))

    await waitFor(() => {
      expect(screen.queryByText('param exampleexample/com')).toBeInTheDocument()
      expect(
        screen.queryByText('hookparams example?example/com'),
      ).toBeInTheDocument()
    })
  })

  test('Character / is not captured as part of a param in path', async () => {
    const screen = getScreen()
    act(() =>
      navigate(routes.params({ value: 'example/com', q: 'example/com' })),
    )

    await waitFor(() => screen.getByText('404'))
  })

  test('navigate to redirect2 should forward params with unreserved characters', async () => {
    const screen = getScreen()
    act(() => navigate('/redirect2/example.com?q=example.com'))
    await waitFor(() => screen.getByText(/param example.comexample.com/i))
  })

  test('navigate to redirect2 should forward params with escaped characters', async () => {
    const screen = getScreen()
    act(() => navigate('/redirect2/example!com?q=example!com'))
    await waitFor(() => screen.getByText(/param example!comexample!com/i))
  })
})

describe('query params should not override path params', () => {
  const ParamPage = ({ id, contactId }: { id: number; contactId: number }) => {
    const params = useParams()

    return (
      <div>
        <p>param {`${id},${contactId}`}</p>
        <p>hookparams {`${params.id},${params.contactId}`}</p>
      </div>
    )
  }

  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Route
        path="/user/{id:Int}/contact/{contactId:Int}"
        page={ParamPage}
        name="contact"
      />
    </Router>
  )

  const getScreen = () => render(<TestRouter />)

  test('query params of same key as path params should not override path params', async () => {
    const screen = getScreen()
    act(() => navigate('/user/1/contact/2?contactId=two'))
    await waitFor(() => {
      expect(screen.queryByText('param 1,2')).toBeInTheDocument()
      expect(screen.queryByText('hookparams 1,2')).toBeInTheDocument()
    })
  })
})

test('unauthenticated user is redirected away from private page', async () => {
  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Route path="/login" page={LoginPage} name="login" />
      <Route path="/about" page={AboutPage} name="about" />
      <PrivateSet unauthenticated="login">
        <Route path="/private" page={PrivatePage} name="private" />
      </PrivateSet>
    </Router>
  )
  const screen = render(<TestRouter />)

  // starts on home page
  await waitFor(() => screen.getByText(/Home Page/i))

  // navigate to private page
  // should redirect to login
  act(() => navigate(routes.private()))

  await waitFor(() => {
    expect(screen.queryByText(/Private Page/i)).not.toBeInTheDocument()
    screen.getByText(/Login Page/i)
    expect(window.location.pathname).toBe('/login')
    expect(window.location.search).toBe('?redirectTo=/private')
  })
})

test('unauthenticated user is redirected including search params', async () => {
  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Route path="/login" page={LoginPage} name="login" />
      <PrivateSet unauthenticated="login">
        <Route path="/private" page={PrivatePage} name="private" />
      </PrivateSet>
    </Router>
  )
  const screen = render(<TestRouter />)

  // starts on home page
  await waitFor(() => screen.getByText(/Home Page/i))

  // navigate to private page
  // should redirect to login
  act(() => navigate(routes.private({ bazinga: 'yeah' })))

  await waitFor(() => {
    expect(screen.queryByText(/Private Page/i)).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
    expect(window.location.search).toBe(
      `?redirectTo=/private${encodeURIComponent('?bazinga=yeah')}`,
    )
    screen.getByText(/Login Page/i)
  })
})

test('authenticated user can access private page', async () => {
  const TestRouter = () => (
    <Router useAuth={mockUseAuth({ isAuthenticated: true })}>
      <Route path="/" page={HomePage} name="home" />
      <PrivateSet unauthenticated="home">
        <Route path="/private" page={PrivatePage} name="private" />
      </PrivateSet>
    </Router>
  )
  const screen = render(<TestRouter />)

  // starts on home page
  await waitFor(() => screen.getByText(/Home Page/i))

  // navigate to private page
  // should not redirect
  act(() => navigate(routes.private()))
  await waitFor(() => {
    expect(screen.getByText(/Private Page/)).toBeInTheDocument()
    expect(screen.queryByText(/Home Page/)).not.toBeInTheDocument()
  })
})

test('can display a loading screen whilst waiting for auth', async () => {
  const TestRouter = () => (
    <Router useAuth={mockUseAuth({ isAuthenticated: false, loading: true })}>
      <Route path="/" page={HomePage} name="home" />
      <PrivateSet
        unauthenticated="home"
        whileLoadingAuth={() => <>Authenticating...</>}
      >
        <Route path="/private" page={PrivatePage} name="private" />
      </PrivateSet>
    </Router>
  )
  const screen = render(<TestRouter />)

  // starts on home page
  await waitFor(() => screen.getByText(/Home Page/i))

  // navigate to private page
  // should not redirect
  act(() => navigate(routes.private()))
  await waitFor(() => {
    expect(screen.getByText(/Authenticating.../)).toBeInTheDocument()
    expect(screen.queryByText(/Home Page/)).not.toBeInTheDocument()
  })
})

test('can display a loading screen with a hook', async () => {
  const HookLoader = () => {
    const [showStill, setShowStill] = useState(false)

    useEffect(() => {
      const timer = setTimeout(() => setShowStill(true), 100)
      return () => clearTimeout(timer)
    }, [])

    return <>{showStill ? 'Still authenticating...' : 'Authenticating...'}</>
  }

  const TestRouter = () => (
    <Router
      useAuth={mockUseAuth({
        isAuthenticated: false,
        loading: true,
        loadingTimeMs: 700,
      })}
    >
      <Route path="/" page={HomePage} name="home" />
      <PrivateSet unauthenticated="home" whileLoadingAuth={HookLoader}>
        <Route path="/private" page={PrivatePage} name="private" />
      </PrivateSet>
    </Router>
  )
  const screen = render(<TestRouter />)

  // starts on home page
  await waitFor(() => screen.getByText(/Home Page/i))

  // navigate to private page
  // should not redirect
  act(() => navigate(routes.private()))
  await waitFor(() => {
    expect(screen.getByText(/Authenticating.../)).toBeInTheDocument()
    expect(screen.queryByText(/Home Page/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Private Page/)).not.toBeInTheDocument()
  })
  await waitFor(() => {
    expect(screen.getByText(/Still authenticating.../)).toBeInTheDocument()
    expect(screen.queryByText(/Home Page/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Private Page/)).not.toBeInTheDocument()
  })
})

test('inits routes two private routes with a space in between and loads as expected', async () => {
  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Route path="/about" page={AboutPage} name="about" />
      <Route path="/redirect" page={RedirectPage} name="redirect" />
      <PrivateSet unauthenticated="home">
        <Route path="/private" page={PrivatePage} name="private" />{' '}
        <Route path="/another-private" page={PrivatePage} name="private" />
      </PrivateSet>

      <Route
        path="/param-test/:value"
        page={({ value }: { value: string }) => <div>param {value}</div>}
        name="params"
      />
    </Router>
  )
  const screen = render(<TestRouter />)

  // starts on home page
  await waitFor(() => screen.getByText(/Home Page/i))
})

test('supports <Set>', async () => {
  const GlobalLayout = ({ children }: WrapperProps) => (
    <div>
      <h1>Global Layout</h1>
      {children}
    </div>
  )

  const TestRouter = () => (
    <Router>
      <Set wrap={GlobalLayout}>
        <Route path="/" page={HomePage} name="home" />
        <Route path="/about" page={AboutPage} name="about" />
        <Route path="/redirect" page={RedirectPage} name="redirect" />
        <PrivateSet unauthenticated="home">
          <Route path="/private" page={PrivatePage} name="private" />
          <Route
            path="/another-private"
            page={PrivatePage}
            name="anotherPrivate"
          />
        </PrivateSet>
      </Set>
    </Router>
  )
  const screen = render(<TestRouter />)

  await waitFor(() => screen.getByText(/Global Layout/i))
  await waitFor(() => screen.getByText(/Home Page/i))
})

test('can use named routes for navigating', async () => {
  const MainLayout = ({ children }: WrapperProps) => {
    return (
      <div>
        <h1>Main Layout</h1>
        <Link to={routes.home()}>Home-link</Link>
        <Link to={routes.about()}>About-link</Link>
        <hr />
        {children}
      </div>
    )
  }

  const TestRouter = () => (
    <Router>
      <Set wrap={MainLayout}>
        <Route path="/" page={HomePage} name="home" />
        <Route path="/about" page={AboutPage} name="about" />
      </Set>
    </Router>
  )

  const screen = render(<TestRouter />)

  // starts on home page, with MainLayout
  await waitFor(() => screen.getByText(/Home Page/))
  await waitFor(() => screen.getByText(/Main Layout/))

  fireEvent.click(screen.getByText('About-link'))
  await waitFor(() => screen.getByText(/About Page/))
})

test('renders only active path', async () => {
  const AboutLayout = ({ children }: WrapperProps) => {
    return (
      <div>
        <h1>About Layout</h1>
        <hr />
        {children}
      </div>
    )
  }

  const LoginLayout = ({ children }: WrapperProps) => {
    return (
      <div>
        <h1>Login Layout</h1>
        <hr />
        {children}
      </div>
    )
  }

  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Set wrap={AboutLayout}>
        <Route path="/about" page={AboutPage} name="about" />
      </Set>
      <Set wrap={LoginLayout}>
        <Route path="/login" page={LoginPage} name="login" />
      </Set>
    </Router>
  )

  const screen = render(<TestRouter />)

  // starts on home page, with no layout
  await waitFor(() => screen.getByText(/Home Page/))
  expect(screen.queryByText('About Layout')).not.toBeInTheDocument()
  expect(screen.queryByText('Login Layout')).not.toBeInTheDocument()

  // go to about page, with only about layout
  act(() => navigate(routes.about()))
  await waitFor(() => screen.getByText(/About Page/))
  expect(screen.queryByText('About Layout')).toBeInTheDocument()
  expect(screen.queryByText('Login Layout')).not.toBeInTheDocument()

  // go to login page, with only login layout
  act(() => navigate(routes.login()))
  await waitFor(() => screen.getByText(/Login Page/))
  expect(screen.queryByText('About Layout')).not.toBeInTheDocument()
  expect(screen.queryByText('Login Layout')).toBeInTheDocument()
})

test('renders first matching route only', async () => {
  const ParamPage = ({ param }: { param: string }) => <div>param {param}</div>

  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Route path="/about" page={AboutPage} name="about" />
      <Route path="/{param}" page={ParamPage} name="param" />
    </Router>
  )

  const screen = render(<TestRouter />)

  await waitFor(() => screen.getByText(/Home Page/))

  // go to about page, and make sure that's the only page rendered
  act(() => navigate(routes.about()))

  await waitFor(() => screen.getByText('About Page'))
  expect(screen.queryByText(/param/)).not.toBeInTheDocument()
})

test('renders first matching route only, even if multiple routes have the same name', async () => {
  const ParamPage = ({ param }: { param: string }) => <div>param {param}</div>
  const AboutTwoPage = () => <h1>About Two Page</h1>

  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Route path="/about" page={AboutPage} name="about" />
      <Route path="/{param}" page={ParamPage} name="about" />
      <Route path="/about" page={AboutTwoPage} name="about" />
      <Route path="/about" page={AboutPage} name="about" />
    </Router>
  )

  const screen = render(<TestRouter />)

  await waitFor(() => screen.getByText(/Home Page/))

  // go to about page, and make sure that's the only page rendered
  act(() => navigate(routes.about()))
  // `getByText` will throw an error if more than one node is found
  // which is perfect, because that's exactly what we want to test
  await waitFor(() => screen.getByText('About Page'))
  expect(screen.queryByText('param')).not.toBeInTheDocument()
  expect(screen.queryByText('About Two Page')).not.toBeInTheDocument()
})

test('renders first matching route only, also with PrivateSet', async () => {
  const ParamPage = ({ param }: { param: string }) => <div>param {param}</div>

  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Route path="/login" page={LoginPage} name="login" />
      <Route path="/about" page={AboutPage} name="about" />
      <PrivateSet unauthenticated="login">
        <Route path="/{param}" page={ParamPage} name="param" />
      </PrivateSet>
    </Router>
  )

  const screen = render(<TestRouter />)

  await waitFor(() => screen.getByText(/Home Page/))

  // go to about page, and make sure that's the only page rendered
  act(() => navigate(routes.about()))
  await waitFor(() => screen.getByText('About Page'))
  expect(screen.queryByText(/param/)).not.toBeInTheDocument()
})

test('renders first matching route only, also with param path outside PrivateSet', async () => {
  const ParamPage = ({ param }: { param: string }) => <div>param {param}</div>

  const TestRouter = () => (
    <Router useAuth={mockUseAuth({ isAuthenticated: true })}>
      <Route path="/" page={HomePage} name="home" />
      <PrivateSet unauthenticated="login">
        <Route path="/private" page={PrivatePage} name="private" />
      </PrivateSet>
      <Route path="/{param}" page={ParamPage} name="param" />
    </Router>
  )

  const screen = render(<TestRouter />)

  await waitFor(() => screen.getByText(/Home Page/))

  // go to about page, and make sure that's the only page rendered
  act(() => navigate(routes.private()))
  await waitFor(() => screen.getByText('Private Page'))
  expect(screen.queryByText(/param/)).not.toBeInTheDocument()
})

test('params should never be an empty object', async () => {
  const ParamPage = () => {
    const params = useParams()
    expect(params).not.toEqual({})
    return null
  }

  const TestRouter = () => (
    <Router>
      <Route path="/test/{documentId}" page={ParamPage} name="param" />
    </Router>
  )

  act(() => navigate('/test/1'))
  render(<TestRouter />)
})

test('params should never be an empty object in Set', async () => {
  const ParamPage = () => {
    return <div>Param Page</div>
  }

  const SetWithUseParams = ({ children }: WrapperProps) => {
    const params = useParams()
    expect(params).not.toEqual({})
    return <>{children}</>
  }

  const TestRouter = () => (
    <Router>
      <Set wrap={SetWithUseParams}>
        <Route path="/test/{documentId}" page={ParamPage} name="param" />
      </Set>
    </Router>
  )

  act(() => navigate('/test/1'))
  const screen = render(<TestRouter />)
  await waitFor(() => screen.getByText('Param Page'))
})

test('params should never be an empty object in Set with waitFor (I)', async () => {
  const ParamPage = () => {
    const { documentId } = useParams()
    return <>documentId: {documentId}</>
  }

  const SetWithUseParams = ({ children }: WrapperProps) => {
    const params = useParams()
    // 1st run: { documentId: '1' }
    // 2nd run: { documentId: '2' }
    expect(params).not.toEqual({})
    return <>{children}</>
  }

  const TestRouter = () => (
    <Router>
      <Set wrap={SetWithUseParams}>
        <Route path="/test/{documentId}" page={ParamPage} name="param" />
      </Set>
      <Route path="/" page={() => <Redirect to="/test/2" />} name="home" />
    </Router>
  )

  act(() => navigate('/test/1'))
  const screen = render(<TestRouter />)
  await waitFor(() => screen.getByText(/documentId: 1/))
  act(() => navigate('/'))
  await waitFor(() => screen.getByText(/documentId: 2/))
})

test('params should never be an empty object in Set without waitFor (II)', async () => {
  const ParamPage = () => {
    const { documentId } = useParams()
    return <>documentId: {documentId}</>
  }

  const SetWithUseParams = ({ children }: WrapperProps) => {
    const params = useParams()
    // 1st run: { documentId: '1' }
    // 2nd run: { documentId: '2' }
    expect(params).not.toEqual({})
    return <>{children}</>
  }

  const TestRouter = () => (
    <Router>
      <Set wrap={SetWithUseParams}>
        <Route path="/test/{documentId}" page={ParamPage} name="param" />
      </Set>
      <Route path="/" page={() => <Redirect to="/test/2" />} name="home" />
    </Router>
  )

  act(() => navigate('/test/1'))
  const screen = render(<TestRouter />)
  act(() => navigate('/'))
  await waitFor(() => screen.getByText(/documentId: 2/))
})

test('Set is not rendered for unauthenticated user.', async () => {
  const ParamPage = () => {
    // This should never be called. We should be redirected to login instead.
    expect(false).toBe(true)
    return null
  }

  const SetWithUseParams = ({ children }: WrapperProps) => {
    // This should never be called. We should be redirected to login instead.
    expect(false).toBe(true)
    return <>{children}</>
  }

  const TestRouter = () => (
    <Router>
      <PrivateSet wrap={SetWithUseParams} unauthenticated="login">
        <Route path="/test/{documentId}" page={ParamPage} name="param" />
      </PrivateSet>
      <Route path="/" page={HomePage} name="home" />
      <Route path="/login" page={() => <div>auth thyself</div>} name="login" />
    </Router>
  )

  // Go to home page and start loading
  // Wait until it has loaded
  // Go to /test/1 and start loading
  // Get redirected to /login
  const screen = render(<TestRouter />)
  await waitFor(() => screen.getByText('Home Page'))
  act(() => navigate('/test/1'))
  await waitFor(() => screen.getByText(/auth thyself/))
})

test('Set is not rendered for unauthenticated user on direct navigation', async () => {
  const ParamPage = () => {
    // This should never be called. We should be redirected to login instead.
    expect(false).toBe(true)
    return null
  }

  const SetWithUseParams = ({ children }: WrapperProps) => {
    // This should never be called. We should be redirected to login instead.
    expect(false).toBe(true)
    return <>{children}</>
  }

  const TestRouter = () => (
    <Router>
      {/* Keeping this around so we don't accidentally break the `private` prop
      on Set until we're ready to remove it */}
      <Set private wrap={SetWithUseParams} unauthenticated="login">
        <Route path="/test/{documentId}" page={ParamPage} name="param" />
      </Set>
      <Route path="/" page={HomePage} name="home" />
      <Route path="/login" page={() => <div>auth thyself</div>} name="login" />
    </Router>
  )

  act(() => navigate('/test/1'))
  const screen = render(<TestRouter />)
  await waitFor(() => screen.getByText(/auth thyself/))
})

// TODO: Remove this entire test once we remove the `<Private>` component
test('Private is an alias for Set private', async () => {
  interface PrivateLayoutProps {
    children: React.ReactNode
    theme: string
  }

  const PrivateLayout = ({ children, theme }: PrivateLayoutProps) => (
    <div>
      <h1>Private Layout ({theme})</h1>
      {children}
    </div>
  )

  const DarkPrivateLayout = ({ children }: WrapperProps) => (
    <PrivateLayout theme="dark">{children}</PrivateLayout>
  )

  const TestRouter = () => (
    <Router useAuth={mockUseAuth({ isAuthenticated: true })}>
      <Route path="/" page={HomePage} name="home" />
      <Private wrap={DarkPrivateLayout} unauthenticated="home">
        <Route path="/private" page={PrivatePage} name="private" />
      </Private>
    </Router>
  )
  const screen = render(<TestRouter />)

  await waitFor(() => screen.getByText(/Home Page/i))

  act(() => navigate('/private'))
  await waitFor(() => screen.getByText(/Private Layout \(dark\)/))
  await waitFor(() => screen.getByText(/Private Page/))
})

test('redirect to last page', async () => {
  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Route path="/about" page={AboutPage} name="about" />
      <PrivateSet unauthenticated="login">
        <Route path="/private" page={PrivatePage} name="private" />
      </PrivateSet>
      <Route path="/login" page={LoginPage} name="login" />
    </Router>
  )
  const screen = render(<TestRouter />)

  // starts on home page
  await waitFor(() => screen.getByText(/Home Page/i))

  // navigate to private page
  // should redirect to login
  act(() => navigate(routes.private()))

  await waitFor(() => {
    expect(screen.queryByText(/Private Page/i)).not.toBeInTheDocument()
    screen.getByText('Login Page')
    expect(window.location.pathname).toBe('/login')
    expect(window.location.search).toBe('?redirectTo=/private')
  })
})

test('no location match means nothing is rendered', async () => {
  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
    </Router>
  )
  const screen = render(<TestRouter />)

  // starts on home page
  await waitFor(() => screen.getByText(/Home Page/i))

  // navigate page that doesn't exist
  act(() => navigate('/not/found'))

  // wait for rendering
  // Otherwise adding a NotFound route still makes this test pass
  await new Promise((r) => setTimeout(r, 200))

  expect(screen.container).toMatchInlineSnapshot('<div />')
})

test('jump to new route, then go back', async () => {
  const HelpPage = () => <h1>Help Page</h1>
  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Route path="/login" page={LoginPage} name="login" />
      <Route path="/about" page={AboutPage} name="about" />
      <Route path="/help" page={HelpPage} name="help" />
    </Router>
  )
  const screen = render(<TestRouter />)

  // starts on home page
  await waitFor(() => screen.getByText('Home Page'))

  act(() => navigate(routes.about()))
  await waitFor(() => screen.getByText('About Page'))
  act(() => navigate(routes.help(), { replace: true }))
  await waitFor(() => screen.getByText('Help Page'))
  act(() => back())
  await waitFor(() => screen.getByText('Home Page'))
})

test('redirect replacing route', async () => {
  const ListWithDefaultParamsPage = (props: { _limit: string }) => {
    if (props['_limit']) {
      return <h1>List Page</h1>
    }
    return <Redirect to="/list?_limit=10" options={{ replace: true }} />
  }
  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Route path="/list" page={ListWithDefaultParamsPage} name="list" />
    </Router>
  )
  const screen = render(<TestRouter />)

  // starts on home page
  await waitFor(() => screen.getByText('Home Page'))

  // This will navigate to /list, which will then redirect to /list?_limit=10
  // which will render `<h1>List Page</h1>`
  act(() => navigate(routes.list()))
  await waitFor(() => screen.getByText('List Page'))
  act(() => back())
  // without options.replace = true in Redirect, back would go to List Page
  await waitFor(() => screen.getByText('Home Page'))
})

describe('trailing slashes', () => {
  const TSNeverRouter = () => (
    <Router trailingSlashes="never">
      <Route path="/" page={HomePage} name="home" />
      <Route path="/about" page={AboutPage} name="about" />
      <Route notfound page={NotFoundPage} />
    </Router>
  )
  const getTSNeverScreen = () => render(<TSNeverRouter />)

  test('starts on home page', async () => {
    const screen = getTSNeverScreen()
    await waitFor(() => screen.getByText(/Home Page/i))
  })

  test('strips trailing slash on navigating to about page', async () => {
    const screen = getTSNeverScreen()
    act(() => navigate('/about/'))
    await waitFor(() => screen.getByText(/About Page/i))
  })

  const TSAlwaysRouter = () => (
    <Router trailingSlashes="always">
      <Route path="/" page={HomePage} name="home" />
      <Route path="/about/" page={AboutPage} name="about" />
      <Route notfound page={NotFoundPage} />
    </Router>
  )
  const getTSAlwaysScreen = () => render(<TSAlwaysRouter />)

  test('starts on home page', async () => {
    const screen = getTSAlwaysScreen()
    await waitFor(() => screen.getByText(/Home Page/i))
  })

  test('adds trailing slash on navigating to about page', async () => {
    const screen = getTSAlwaysScreen()
    act(() => navigate('/about'))
    await waitFor(() => screen.getByText(/About Page/i))
  })

  const TSPreserveRouter = () => (
    <Router trailingSlashes="preserve">
      <Route path="/" page={HomePage} name="home" />
      <Route path="/about" page={AboutPage} name="about" />
      <Route path="/contact/" page={() => <h1>Contact Page</h1>} name="about" />
      <Route notfound page={NotFoundPage} />
    </Router>
  )
  const getTSPreserveScreen = () => render(<TSPreserveRouter />)

  test('starts on home page', async () => {
    const screen = getTSPreserveScreen()
    await waitFor(() => screen.getByText(/Home Page/i))
  })

  test('navigates to about page as is', async () => {
    const screen = getTSPreserveScreen()
    act(() => navigate('/about'))
    await waitFor(() => screen.getByText(/About Page/i))
  })

  test('navigates to contact page as is', async () => {
    const screen = getTSPreserveScreen()
    act(() => navigate('/contact/'))
    await waitFor(() => screen.getByText(/Contact Page/i))
  })
})

test('params should be updated if navigated to different route with same page', async () => {
  const UserPage = ({ id }: { id?: number }) => {
    const { id: idFromContext } = useParams()
    return (
      <>
        <p>param {id ? id : 'no-id'}</p>
        <p>hookparams {idFromContext ? idFromContext : 'no-param-id'} </p>
      </>
    )
  }
  const TestRouter = () => (
    <Router>
      <Route path="/user" page={UserPage} name="allUsers" />
      <Route path="/user/{id:Int}" page={UserPage} name="user" />
    </Router>
  )

  act(() => navigate('/user'))
  const screen = render(<TestRouter />)
  // Wait for page load
  await waitFor(() => screen.getByText('param no-id'))
  act(() => navigate('/user/99'))

  await waitFor(() => {
    expect(screen.queryByText('param 99')).toBeInTheDocument()
    expect(screen.queryByText('hookparams 99')).toBeInTheDocument()
  })
})

test('should handle ref and key as search params', async () => {
  const ParamsPage = () => {
    const { ref, key } = useParams()
    return <p>{JSON.stringify({ ref, key })}</p>
  }

  const TestRouter = () => (
    <Router>
      <Route path="/params" page={ParamsPage} name="params" />
    </Router>
  )

  act(() => navigate('/params?ref=1&key=2'))
  const screen = render(<TestRouter />)

  await waitFor(() => {
    expect(screen.queryByText(`{"ref":"1","key":"2"}`)).toBeInTheDocument()
  })
})

describe('Unauthorized redirect error messages', () => {
  let err: typeof console.error

  beforeAll(() => {
    err = console.error
    console.error = vi.fn()
  })

  afterAll(() => {
    console.error = err
  })

  test('PrivateSet with unauthenticated prop with nonexisting page', async () => {
    const TestRouter = ({ authenticated }: { authenticated?: boolean }) => (
      <Router useAuth={mockUseAuth({ isAuthenticated: authenticated })}>
        <Route path="/" page={HomePage} name="home" />
        <PrivateSet unauthenticated="does-not-exist">
          <Route path="/private" page={PrivatePage} name="private" />
        </PrivateSet>
      </Router>
    )

    act(() => navigate('/private'))
    expect(() => render(<TestRouter authenticated={false} />)).toThrow(
      'We could not find a route named does-not-exist',
    )
  })

  test('PrivateSet redirecting to page that needs parameters', async () => {
    const TestRouter = ({ authenticated }: { authenticated?: boolean }) => (
      <Router useAuth={mockUseAuth({ isAuthenticated: authenticated })}>
        <Route path="/" page={HomePage} name="home" />
        <Route path="/param-test/{value}" page={ParamPage} name="params" />
        <PrivateSet unauthenticated="params">
          <Route path="/private" page={PrivatePage} name="private" />
        </PrivateSet>
      </Router>
    )

    act(() => navigate('/private'))
    expect(() => render(<TestRouter authenticated={false} />)).toThrow(
      'Redirecting to route "params" requires the route parameter "value", ' +
        "which the current route doesn't have. Please choose a different route",
    )
  })
})

describe('PrivateSet role checks', () => {
  const ForbiddenPage = () => <h1>Forbidden Page</h1>
  const OrgLoginPage = () => <h1>Org Login Page</h1>
  const ProjectsPage = () => <h1>Projects Page</h1>
  const SettingsPage = () => <h1>Settings Page</h1>

  const toList = (roles: string | string[]) =>
    Array.isArray(roles) ? roles : [roles]

  /** An auth provider's `useAuth`, for a user with `roles` in `currentUser` */
  const useAuthWithRoles =
    ({
      isAuthenticated = true,
      roles = [],
    }: {
      isAuthenticated?: boolean
      roles?: string[]
    }) =>
    () => {
      const hasRole = (rolesToCheck: string | string[]) =>
        toList(rolesToCheck).some((role) => roles.includes(role))

      return createDummyAuthContextValues({
        loading: false,
        isAuthenticated,
        hasRole,
        hasUserRole: hasRole,
      })
    }

  interface TestMembership {
    organizationId: string
    role: string
    permissions: string[]
  }

  /** What the test provider provides: the id of the organization */
  const TestOrgContext = React.createContext<string | undefined>(undefined)

  /** Ids of the organizations the test provider mounted and unmounted */
  const providerLog: { mounted: string[]; unmounted: string[] } = {
    mounted: [],
    unmounted: [],
  }

  /**
   * A tenancy for a user with `membershipBySlug[orgSlug]` in each
   * organization, like the one from `@cedarjs/tenancy/web`: no organization
   * without an `orgSlug` param, and no membership when not signed in
   */
  const tenancyFor = (
    membershipBySlug: Record<string, { role: string; permissions?: string[] }>,
  ): Tenancy => {
    const toMembership = (slug: string): TestMembership => ({
      organizationId: `id-${slug}`,
      role: membershipBySlug[slug].role,
      permissions: membershipBySlug[slug].permissions ?? [],
    })

    const useOrg: UseOrg = (useAuth, params) => {
      const { isAuthenticated } = useAuth()

      if (!Object.hasOwn(params, 'orgSlug')) {
        return null
      }

      const slug = params.orgSlug
      const memberships = isAuthenticated
        ? Object.keys(membershipBySlug).map(toMembership)
        : []

      return {
        membership:
          isAuthenticated && Object.hasOwn(membershipBySlug, slug)
            ? toMembership(slug)
            : null,
        memberships,
      }
    }

    const OrgProvider = ({ membership, children }: OrgProviderProps) => {
      const { organizationId } = membership

      useEffect(() => {
        providerLog.mounted.push(organizationId)

        return () => {
          providerLog.unmounted.push(organizationId)
        }
      }, [organizationId])

      return (
        <TestOrgContext.Provider value={organizationId}>
          {children}
        </TestOrgContext.Provider>
      )
    }

    return { useOrg, OrgProvider, notAMember: <p>Not a member</p> }
  }

  // The router's own tests are an app without tenancy, where sets have
  // `roles` but no `userRoles`, `orgRoles` or `orgPermission`, and the
  // Router no `tenancy`. Spreading the props, rather than writing them out,
  // lets them through the type check.
  const userRoles = (roles: string | string[]) => ({ userRoles: roles })
  const orgRoles = (roles: string | string[]) => ({ orgRoles: roles })
  const orgPermission = (permission: string) => ({ orgPermission: permission })
  const routerTenancy = (tenancy: Tenancy) => ({ tenancy })

  describe('unauthorized', () => {
    const TestRouter = ({ useAuth }: { useAuth: UseAuth }) => (
      <Router useAuth={useAuth}>
        <Route path="/" page={HomePage} name="home" />
        <Route path="/login" page={LoginPage} name="login" />
        <Route path="/forbidden" page={ForbiddenPage} name="forbidden" />
        <PrivateSet
          unauthenticated="login"
          unauthorized="forbidden"
          roles="admin"
        >
          <Route path="/admin" page={PrivatePage} name="admin" />
        </PrivateSet>
        <PrivateSet unauthenticated="login" roles="admin">
          <Route path="/no-unauthorized" page={AboutPage} name="noUnauth" />
        </PrivateSet>
      </Router>
    )

    test('redirects a user without the role to unauthorized', async () => {
      const screen = render(
        <TestRouter useAuth={useAuthWithRoles({ roles: ['editor'] })} />,
      )

      act(() => navigate('/admin'))

      await waitFor(() => {
        screen.getByText(/Forbidden Page/i)
        expect(window.location.pathname).toBe('/forbidden')
        expect(window.location.search).toBe('')
      })
      expect(screen.queryByText(/Private Page/i)).not.toBeInTheDocument()
    })

    test('redirects a user who is not signed in to unauthenticated', async () => {
      const screen = render(
        <TestRouter useAuth={useAuthWithRoles({ isAuthenticated: false })} />,
      )

      act(() => navigate('/admin'))

      await waitFor(() => {
        screen.getByText(/Login Page/i)
        expect(window.location.pathname).toBe('/login')
        expect(window.location.search).toBe('?redirectTo=/admin')
      })
    })

    test('lets a user with the role in', async () => {
      const screen = render(
        <TestRouter useAuth={useAuthWithRoles({ roles: ['admin'] })} />,
      )

      act(() => navigate('/admin'))

      await waitFor(() => screen.getByText(/Private Page/i))
    })

    test('without it, a user without the role goes to unauthenticated', async () => {
      const screen = render(
        <TestRouter useAuth={useAuthWithRoles({ roles: ['editor'] })} />,
      )

      act(() => navigate('/no-unauthorized'))

      await waitFor(() => {
        screen.getByText(/Login Page/i)
        expect(window.location.pathname).toBe('/login')
        expect(window.location.search).toBe('?redirectTo=/no-unauthorized')
      })
    })
  })

  describe('route params in redirects', () => {
    const TestRouter = ({ useAuth }: { useAuth: UseAuth }) => (
      <Router useAuth={useAuth}>
        <Route path="/" page={HomePage} name="home" />
        <Route
          path="/org/{orgSlug}/login"
          page={OrgLoginPage}
          name="orgLogin"
        />
        <Route
          path="/org/{orgSlug}/projects"
          page={ProjectsPage}
          name="projects"
        />
        <PrivateSet
          unauthenticated="orgLogin"
          unauthorized="projects"
          roles="owner"
        >
          <Route
            path="/org/{orgSlug}/settings"
            page={SettingsPage}
            name="settings"
          />
        </PrivateSet>
      </Router>
    )

    test('fills unauthorized params from the current route', async () => {
      const screen = render(
        <TestRouter useAuth={useAuthWithRoles({ roles: ['member'] })} />,
      )

      act(() => navigate('/org/acme/settings'))

      await waitFor(() => {
        screen.getByText(/Projects Page/i)
        expect(window.location.pathname).toBe('/org/acme/projects')
      })
    })

    test('fills unauthenticated params from the current route', async () => {
      const screen = render(
        <TestRouter useAuth={useAuthWithRoles({ isAuthenticated: false })} />,
      )

      act(() => navigate('/org/acme/settings'))

      await waitFor(() => {
        screen.getByText(/Org Login Page/i)
        expect(window.location.pathname).toBe('/org/acme/login')
        expect(window.location.search).toBe('?redirectTo=/org/acme/settings')
      })
    })

    test('fills params of a custom type as the text in the path', async () => {
      const PostPage = () => <h1>Post Page</h1>
      const EditPostPage = () => <h1>Edit Post Page</h1>
      // `parse` returns an array, which isn't the text in the path
      const slug = {
        match: /\w+-\w+/,
        parse: (value: string) => value.split('-'),
      }

      const screen = render(
        <Router
          useAuth={useAuthWithRoles({ roles: ['member'] })}
          paramTypes={{ slug }}
        >
          <Route path="/" page={HomePage} name="home" />
          <Route path="/login" page={LoginPage} name="login" />
          <Route path="/post/{name:slug}" page={PostPage} name="post" />
          <PrivateSet
            unauthenticated="login"
            unauthorized="post"
            roles="editor"
          >
            <Route
              path="/post/{name:slug}/edit"
              page={EditPostPage}
              name="editPost"
            />
          </PrivateSet>
        </Router>,
      )

      act(() => navigate('/post/cedar-router/edit'))

      await waitFor(() => {
        screen.getByText(/Post Page/i)
        expect(window.location.pathname).toBe('/post/cedar-router')
      })
    })
  })

  describe('userRoles', () => {
    const TestRouter = ({ useAuth }: { useAuth: UseAuth }) => (
      <Router useAuth={useAuth}>
        <Route path="/" page={HomePage} name="home" />
        <Route path="/login" page={LoginPage} name="login" />
        <Route path="/forbidden" page={ForbiddenPage} name="forbidden" />
        <PrivateSet
          unauthenticated="login"
          unauthorized="forbidden"
          {...userRoles('admin')}
        >
          <Route path="/admin" page={PrivatePage} name="admin" />
        </PrivateSet>
      </Router>
    )

    test('lets a user with the role in currentUser.roles in', async () => {
      const screen = render(
        <TestRouter useAuth={useAuthWithRoles({ roles: ['admin'] })} />,
      )

      act(() => navigate('/admin'))

      await waitFor(() => screen.getByText(/Private Page/i))
    })

    test('redirects a user without it', async () => {
      const screen = render(
        <TestRouter useAuth={useAuthWithRoles({ roles: ['editor'] })} />,
      )

      act(() => navigate('/admin'))

      await waitFor(() => screen.getByText(/Forbidden Page/i))
      expect(screen.queryByText(/Private Page/i)).not.toBeInTheDocument()
    })
  })

  describe('tenancy', () => {
    /** An organization's layout, to see whether a set's wrap renders */
    const OrgLayout = ({ children }: WrapperProps) => {
      const organizationId = React.useContext(TestOrgContext)

      return (
        <>
          <p>Org Layout of {organizationId ?? 'no organization'}</p>
          {children}
        </>
      )
    }

    const MembersPage = () => <h1>Members Page</h1>
    const DashboardPage = () => {
      const organizationId = React.useContext(TestOrgContext)

      return <h1>Dashboard of {organizationId ?? 'no organization'}</h1>
    }
    const PublicOrgPage = () => {
      const organizationId = React.useContext(TestOrgContext)

      return <h1>Public Org Page of {organizationId ?? 'no organization'}</h1>
    }

    beforeEach(() => {
      providerLog.mounted = []
      providerLog.unmounted = []
    })

    const TestRouter = ({
      useAuth,
      membershipBySlug,
    }: {
      useAuth: UseAuth
      membershipBySlug: Record<string, { role: string; permissions?: string[] }>
    }) => (
      <Router
        useAuth={useAuth}
        {...routerTenancy(tenancyFor(membershipBySlug))}
      >
        <Route path="/" page={HomePage} name="home" />
        <Route path="/login" page={LoginPage} name="login" />
        <Route path="/orgs/{orgSlug}" page={PublicOrgPage} name="publicOrg" />
        <PrivateSet unauthenticated="login">
          <Route path="/dashboard" page={DashboardPage} name="dashboard" />
        </PrivateSet>
        <PrivateSet wrap={OrgLayout} unauthenticated="login">
          <Route
            path="/org/{orgSlug}/projects"
            page={ProjectsPage}
            name="projects"
          />
          <Route path="/org/{orgSlug}/tasks" page={PrivatePage} name="tasks" />
          <PrivateSet
            unauthenticated="login"
            unauthorized="projects"
            {...orgRoles(['owner', 'admin'])}
          >
            <Route
              path="/org/{orgSlug}/settings"
              page={SettingsPage}
              name="settings"
            />
          </PrivateSet>
          <PrivateSet
            unauthenticated="login"
            unauthorized="projects"
            {...userRoles('staff')}
            {...orgRoles('owner')}
          >
            <Route
              path="/org/{orgSlug}/billing"
              page={PrivatePage}
              name="billing"
            />
          </PrivateSet>
        </PrivateSet>
        <PrivateSet
          wrap={OrgLayout}
          unauthenticated="login"
          unauthorized="projects"
          {...orgPermission('members.manage')}
        >
          <Route
            path="/org/{orgSlug}/members"
            page={MembersPage}
            name="members"
          />
        </PrivateSet>
      </Router>
    )

    describe('the organization provider', () => {
      test('is rendered around the set wrap and the page', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{ acme: { role: 'member' } }}
          />,
        )

        act(() => navigate('/org/acme/projects'))

        await waitFor(() => {
          screen.getByText('Org Layout of id-acme')
          screen.getByText(/Projects Page/i)
        })
      })

      test('is rendered once for nested private sets', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{ acme: { role: 'owner' } }}
          />,
        )

        act(() => navigate('/org/acme/settings'))

        await waitFor(() => screen.getByText(/Settings Page/i))
        expect(providerLog.mounted).toEqual(['id-acme'])
      })

      test('stays mounted between pages at the same depth', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{ acme: { role: 'owner' } }}
          />,
        )

        act(() => navigate('/org/acme/projects'))
        await waitFor(() => screen.getByText(/Projects Page/i))

        act(() => navigate('/org/acme/tasks'))
        await waitFor(() => screen.getByText(/Private Page/i))

        expect(providerLog.mounted).toEqual(['id-acme'])
        expect(providerLog.unmounted).toEqual([])
      })

      test('stays mounted when navigating into a nested private set', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{ acme: { role: 'owner' } }}
          />,
        )

        act(() => navigate('/org/acme/projects'))
        await waitFor(() => screen.getByText(/Projects Page/i))

        act(() => navigate('/org/acme/settings'))
        await waitFor(() => screen.getByText(/Settings Page/i))

        act(() => navigate('/org/acme/projects'))
        await waitFor(() => screen.getByText(/Projects Page/i))

        expect(providerLog.mounted).toEqual(['id-acme'])
        expect(providerLog.unmounted).toEqual([])
      })

      test('is replaced when switching organization', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{
              acme: { role: 'member' },
              globex: { role: 'member' },
            }}
          />,
        )

        act(() => navigate('/org/acme/projects'))
        await waitFor(() => screen.getByText('Org Layout of id-acme'))

        act(() => navigate('/org/globex/projects'))
        await waitFor(() => screen.getByText('Org Layout of id-globex'))

        expect(providerLog.mounted).toEqual(['id-acme', 'id-globex'])
        expect(providerLog.unmounted).toEqual(['id-acme'])
      })

      test('is not rendered on a private route outside an organization', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{ acme: { role: 'member' } }}
          />,
        )

        act(() => navigate('/dashboard'))

        await waitFor(() => screen.getByText('Dashboard of no organization'))
        expect(providerLog.mounted).toEqual([])
      })

      test('is not rendered on a public route with an orgSlug', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{ acme: { role: 'member' } }}
          />,
        )

        act(() => navigate('/orgs/acme'))

        await waitFor(() =>
          screen.getByText('Public Org Page of no organization'),
        )
        expect(providerLog.mounted).toEqual([])
      })

      test('is not rendered while auth is loading', async () => {
        const useAuth = () =>
          createDummyAuthContextValues({
            loading: true,
            isAuthenticated: false,
          })

        const screen = render(
          <Router
            useAuth={useAuth}
            {...routerTenancy(tenancyFor({ acme: { role: 'owner' } }))}
          >
            <Route path="/login" page={LoginPage} name="login" />
            <PrivateSet
              unauthenticated="login"
              whileLoadingAuth={() => <p>Loading auth</p>}
            >
              <Route
                path="/org/{orgSlug}/projects"
                page={ProjectsPage}
                name="projects"
              />
            </PrivateSet>
          </Router>,
        )

        act(() => navigate('/org/acme/projects'))

        await waitFor(() => screen.getByText('Loading auth'))
        expect(screen.queryByText(/Projects Page/i)).not.toBeInTheDocument()
        expect(providerLog.mounted).toEqual([])
      })

      test('is not rendered for a user who is not signed in', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({ isAuthenticated: false })}
            membershipBySlug={{ acme: { role: 'owner' } }}
          />,
        )

        act(() => navigate('/org/acme/projects'))

        await waitFor(() => {
          screen.getByText(/Login Page/i)
          expect(window.location.pathname).toBe('/login')
          expect(window.location.search).toBe('?redirectTo=/org/acme/projects')
        })
        expect(providerLog.mounted).toEqual([])
      })
    })

    describe('a user who is not a member', () => {
      test('gets notAMember, without the layout or the page', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{ other: { role: 'owner' } }}
          />,
        )

        act(() => navigate('/org/acme/projects'))

        await waitFor(() => screen.getByText('Not a member'))
        expect(screen.queryByText(/Org Layout/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/Projects Page/i)).not.toBeInTheDocument()
        expect(window.location.pathname).toBe('/org/acme/projects')
      })

      test('gets notAMember on a set with orgRoles too, not a redirect', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{ other: { role: 'owner' } }}
          />,
        )

        act(() => navigate('/org/acme/settings'))

        await waitFor(() => screen.getByText('Not a member'))
        expect(window.location.pathname).toBe('/org/acme/settings')
      })
    })

    describe('orgRoles', () => {
      test('lets a member with the role in the organization in', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{ acme: { role: 'admin' } }}
          />,
        )

        act(() => navigate('/org/acme/settings'))

        await waitFor(() => screen.getByText(/Settings Page/i))
      })

      test('redirects a member without it to unauthorized', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{
              acme: { role: 'member' },
              other: { role: 'owner' },
            }}
          />,
        )

        act(() => navigate('/org/acme/settings'))

        await waitFor(() => {
          screen.getByText(/Projects Page/i)
          expect(window.location.pathname).toBe('/org/acme/projects')
        })
        expect(screen.queryByText(/Settings Page/i)).not.toBeInTheDocument()
      })

      test('with userRoles too, needs both', async () => {
        const ownerOnly = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{ acme: { role: 'owner' } }}
          />,
        )

        act(() => navigate('/org/acme/billing'))

        await waitFor(() => ownerOnly.getByText(/Projects Page/i))
        ownerOnly.unmount()

        const staffOnly = render(
          <TestRouter
            useAuth={useAuthWithRoles({ roles: ['staff'] })}
            membershipBySlug={{ acme: { role: 'member' } }}
          />,
        )

        act(() => navigate('/org/acme/billing'))

        await waitFor(() => staffOnly.getByText(/Projects Page/i))
        staffOnly.unmount()

        const both = render(
          <TestRouter
            useAuth={useAuthWithRoles({ roles: ['staff'] })}
            membershipBySlug={{ acme: { role: 'owner' } }}
          />,
        )

        act(() => navigate('/org/acme/billing'))

        await waitFor(() => both.getByText(/Private Page/i))
      })
    })

    describe('orgPermission', () => {
      test('lets a member with the permission in', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{
              acme: { role: 'member', permissions: ['members.manage'] },
            }}
          />,
        )

        act(() => navigate('/org/acme/members'))

        await waitFor(() => {
          screen.getByText('Org Layout of id-acme')
          screen.getByText(/Members Page/i)
        })
      })

      test('redirects a member without it, without rendering its wrap', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{
              acme: { role: 'owner', permissions: ['projects.read'] },
            }}
          />,
        )

        act(() => navigate('/org/acme/members'))

        await waitFor(() => {
          screen.getByText(/Projects Page/i)
          expect(window.location.pathname).toBe('/org/acme/projects')
        })
        expect(screen.queryByText(/Members Page/i)).not.toBeInTheDocument()
      })

      test('redirects a member whose membership has no permissions', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({})}
            membershipBySlug={{ acme: { role: 'owner' } }}
          />,
        )

        act(() => navigate('/org/acme/members'))

        await waitFor(() => screen.getByText(/Projects Page/i))
        expect(screen.queryByText(/Members Page/i)).not.toBeInTheDocument()
      })

      test('redirects a user who is not signed in to unauthenticated', async () => {
        const screen = render(
          <TestRouter
            useAuth={useAuthWithRoles({ isAuthenticated: false })}
            membershipBySlug={{
              acme: { role: 'member', permissions: ['members.manage'] },
            }}
          />,
        )

        act(() => navigate('/org/acme/members'))

        await waitFor(() => {
          screen.getByText(/Login Page/i)
          expect(window.location.search).toBe('?redirectTo=/org/acme/members')
        })
      })
    })

    describe('without an organization to check in', () => {
      let err: typeof console.error

      beforeAll(() => {
        err = console.error
        console.error = vi.fn()
      })

      afterAll(() => {
        console.error = err
      })

      test.each([
        ['orgRoles', orgRoles('owner')],
        ['orgPermission', orgPermission('members.manage')],
      ])(
        'throws for %s without tenancy on the Router, even when not signed in',
        async (prop, props) => {
          const TestRouter = () => (
            <Router useAuth={useAuthWithRoles({ isAuthenticated: false })}>
              <Route path="/login" page={LoginPage} name="login" />
              <PrivateSet unauthenticated="login" {...props}>
                <Route
                  path="/org/{orgSlug}/settings"
                  page={SettingsPage}
                  name="settings"
                />
              </PrivateSet>
            </Router>
          )

          act(() => navigate('/org/acme/settings'))
          expect(() => render(<TestRouter />)).toThrow(
            `A PrivateSet with \`${prop}\` needs \`tenancy\` on the Router`,
          )
        },
      )

      test('waits for auth to load when useOrg finds no organization', async () => {
        const noOrgTenancy = { ...tenancyFor({}), useOrg: () => null }
        const App = ({ loading }: { loading: boolean }) => (
          <Router
            useAuth={() =>
              createDummyAuthContextValues({
                loading,
                isAuthenticated: !loading,
              })
            }
            {...routerTenancy(noOrgTenancy)}
          >
            <Route path="/login" page={LoginPage} name="login" />
            <PrivateSet
              unauthenticated="login"
              whileLoadingAuth={() => <p>Loading auth</p>}
              {...orgRoles('owner')}
            >
              <Route
                path="/org/{orgSlug}/settings"
                page={SettingsPage}
                name="settings"
              />
            </PrivateSet>
          </Router>
        )

        act(() => navigate('/org/acme/settings'))

        const loading = render(<App loading />)
        await waitFor(() => loading.getByText('Loading auth'))
        loading.unmount()

        expect(() => render(<App loading={false} />)).toThrow(
          "got no organization from the Router's `tenancy`",
        )
      })

      test('throws on a route without an orgSlug param', async () => {
        const TestRouter = () => (
          <Router
            useAuth={useAuthWithRoles({})}
            {...routerTenancy(tenancyFor({ acme: { role: 'owner' } }))}
          >
            <Route path="/login" page={LoginPage} name="login" />
            <PrivateSet unauthenticated="login" {...orgRoles('owner')}>
              <Route path="/settings" page={SettingsPage} name="settings" />
            </PrivateSet>
          </Router>
        )

        act(() => navigate('/settings'))
        expect(() => render(<TestRouter />)).toThrow(
          'and the route has no `orgSlug` param',
        )
      })

      test("throws when the app's own useOrg finds no organization", async () => {
        const TestRouter = () => (
          <Router
            useAuth={useAuthWithRoles({})}
            {...routerTenancy({
              ...tenancyFor({ acme: { role: 'owner' } }),
              useOrg: () => null,
            })}
          >
            <Route path="/login" page={LoginPage} name="login" />
            <PrivateSet unauthenticated="login" {...orgPermission('a.b')}>
              <Route
                path="/org/{orgSlug}/settings"
                page={SettingsPage}
                name="settings"
              />
            </PrivateSet>
          </Router>
        )

        act(() => navigate('/org/acme/settings'))
        expect(() => render(<TestRouter />)).toThrow(
          "got no organization from the Router's `tenancy` for this route",
        )
      })

      test("passes on an error the app's own useOrg throws", async () => {
        const TestRouter = () => (
          <Router
            useAuth={useAuthWithRoles({})}
            {...routerTenancy({
              ...tenancyFor({ acme: { role: 'owner' } }),
              useOrg: () => {
                throw new Error('This organization is suspended')
              },
            })}
          >
            <Route path="/login" page={LoginPage} name="login" />
            <PrivateSet unauthenticated="login" {...orgRoles('owner')}>
              <Route
                path="/org/{orgSlug}/settings"
                page={SettingsPage}
                name="settings"
              />
            </PrivateSet>
          </Router>
        )

        act(() => navigate('/org/acme/settings'))
        expect(() => render(<TestRouter />)).toThrow(
          'This organization is suspended',
        )
      })
    })
  })
})

describe('Multiple nested private sets', () => {
  const HomePage = () => <h1>Home Page</h1>
  const PrivateNoRolesAssigned = () => <h1>Private No Roles Page</h1>
  const PrivateEmployeePage = () => <h1>Private Employee Page</h1>
  const PrivateAdminPage = () => <h1>Private Admin Page</h1>

  interface LevelLayoutProps {
    children: React.ReactNode
    level: string
  }

  const LevelLayout = ({ children, level }: LevelLayoutProps) => (
    <div>
      Level: {level}
      {children}
    </div>
  )

  const Level1Layout = ({ children }: WrapperProps) => (
    <LevelLayout level="1">{children}</LevelLayout>
  )

  const TestRouter = ({ useAuthMock }: { useAuthMock: UseAuth }) => (
    <Router useAuth={useAuthMock}>
      <Route path="/" page={HomePage} name="home" />
      <PrivateSet unauthenticated="home" wrap={Level1Layout}>
        <Route
          path="/no-roles-assigned"
          page={PrivateNoRolesAssigned}
          name="noRolesAssigned"
        />
        <PrivateSet
          unauthenticated="noRolesAssigned"
          roles={['ADMIN', 'EMPLOYEE']}
        >
          <PrivateSet unauthenticated="privateAdmin" roles={['EMPLOYEE']}>
            <Route
              path="/employee"
              page={PrivateEmployeePage}
              name="privateEmployee"
            />
          </PrivateSet>

          <PrivateSet unauthenticated="privateEmployee" roles={['ADMIN']}>
            <Route path="/admin" page={PrivateAdminPage} name="privateAdmin" />
          </PrivateSet>
        </PrivateSet>
      </PrivateSet>
    </Router>
  )

  test('is authenticated but does not have matching roles', async () => {
    const screen = render(
      <TestRouter
        useAuthMock={mockUseAuth({
          isAuthenticated: true,
          hasRole: false,
        })}
      />,
    )

    act(() => navigate('/employee'))

    await waitFor(() => {
      expect(screen.queryByText(`Private No Roles Page`)).toBeInTheDocument()
      expect(screen.queryByText(`Level: 1`)).toBeInTheDocument()
    })
  })

  test('is not authenticated', async () => {
    const screen = render(
      <TestRouter
        useAuthMock={mockUseAuth({
          isAuthenticated: false,
          hasRole: false,
        })}
      />,
    )

    act(() => navigate('/employee'))

    await waitFor(() => {
      expect(screen.queryByText(`Home Page`)).toBeInTheDocument()
      expect(screen.queryByText(`Level`)).not.toBeInTheDocument()
    })
  })

  test('is authenticated and has a matching role', async () => {
    const screen = render(
      <TestRouter
        useAuthMock={mockUseAuth({
          isAuthenticated: true,
          hasRole: (role) => {
            return role.includes('ADMIN')
          },
        })}
      />,
    )

    act(() => navigate('/admin'))
    await waitFor(() => {
      expect(screen.queryByText(`Private Admin Page`)).toBeInTheDocument()
    })
  })

  test('returns the correct page if has a matching role', async () => {
    const screen = render(
      <TestRouter
        useAuthMock={mockUseAuth({
          isAuthenticated: true,
          hasRole: (role) => {
            return role.includes('ADMIN')
          },
        })}
      />,
    )

    act(() => navigate('/admin'))

    await waitFor(() => {
      expect(screen.queryByText(`Private Admin Page`)).toBeInTheDocument()
    })
  })
})

describe('Multiple nested sets', () => {
  const HomePage = () => <h1>Home Page</h1>
  const Page = () => <h1>Page</h1>

  interface DebugLayoutProps {
    children: React.ReactNode
    theme: string
    otherProp?: string
    level: string
  }

  const DebugLayout = (props: DebugLayoutProps) => {
    return (
      <div>
        <p>Theme: {props.theme}</p>
        <p>Other Prop: {props.otherProp}</p>
        <p>Page Level: {props.level}</p>
        {props.children}
      </div>
    )
  }

  const Level1DebugLayout = ({ children }: WrapperProps) => (
    <DebugLayout level="1" theme="blue">
      {children}
    </DebugLayout>
  )

  const TestRouter = () => (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Set wrap={Level1DebugLayout}>
        <Route path="/level1" page={Page} name="level1" />
        <Set>
          <Route path="/level2" page={Page} name="level2" />
          <Set>
            <Route path="/level3" page={Page} name="level3" />
          </Set>
        </Set>
      </Set>
    </Router>
  )

  test('level 1, matches expected props', async () => {
    act(() => navigate('/level1'))

    const screen = render(<TestRouter />)

    await waitFor(() => {
      expect(screen.queryByText('Theme: blue')).toBeInTheDocument()
      expect(screen.queryByText('Other Prop:')).toBeInTheDocument()
      expect(screen.queryByText('Page Level: 1')).toBeInTheDocument()
    })
  })

  test('level 2, renders the level 1 wrapper', async () => {
    act(() => navigate('/level2'))

    const screen = render(<TestRouter />)

    await waitFor(() => {
      expect(screen.queryByText('Page')).toBeInTheDocument()
      expect(screen.queryByText('Theme: blue')).toBeInTheDocument()
      expect(screen.queryByText('Other Prop:')).toBeInTheDocument()
      expect(screen.queryByText('Page Level: 1')).toBeInTheDocument()
    })
  })

  test('level 3, renders the level 1 wrapper', async () => {
    const screen = render(<TestRouter />)

    act(() => navigate('/level3'))

    await waitFor(() => {
      expect(screen.queryByText('Theme: blue')).toBeInTheDocument()
      expect(screen.queryByText('Other Prop:')).toBeInTheDocument()
      expect(screen.queryByText('Page Level: 1')).toBeInTheDocument()
    })
  })
})
