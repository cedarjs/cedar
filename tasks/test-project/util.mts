import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import execa from 'execa'
import type { Options as ExecaOptions } from 'execa'
import prompts from 'prompts'

import { getOutputPath } from './paths.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BLOG_POST_PAGE_STORY_RENDER = `export const Primary: Story = {
  render: (args) => {
    return <BlogPostPage id={'4c3d3e8e-2b1a-4f5c-8c7d-000000000042'} {...args} />
  },
}
`

const WATERFALL_PAGE_STORY_RENDER = `export const Primary: Story = {
  render: (args) => {
    return <WaterfallPage id={'4c3d3e8e-2b1a-4f5c-8c7d-000000000042'} {...args} />
  },
}
`

const PROFILE_PAGE_BODY = `{ const { currentUser, isAuthenticated, hasRole, loading } = useAuth()

if (loading) {
  return <p>Loading...</p>
}

return (
  <>
    <Metadata title="Profile" description="Profile page" og />

    <h1 className="text-2xl">Profile</h1>

    <table className="rw-table">
      <thead>
        <tr>
          <th>Key</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>ID</td>
          <td>{currentUser.id}</td>
        </tr>
        <tr>
          <td>ROLES</td>
          <td>{currentUser.roles}</td>
        </tr>
        <tr>
          <td>EMAIL</td>
          <td>{currentUser.email}</td>
        </tr>

        <tr key="isAuthenticated">
          <td>isAuthenticated</td>
          <td>{JSON.stringify(isAuthenticated)}</td>
        </tr>

        <tr key="hasRole">
          <td>Is Admin</td>
          <td>{JSON.stringify(hasRole('ADMIN'))}</td>
        </tr>
      </tbody>
    </table>
  </>
)
      }`

const BLOG_POST_PAGE_BODY = `{
  return (
    <>
      <Metadata title={\`Post \${id}\`} description={\`Description \${id}\`} og />

      <BlogPostCell id={id} />
    </>
  )
}`

const WATERFALL_PAGE_BODY = `
<WaterfallBlogPostCell id={id} />
`

const ABOUT_PAGE_BODY = `
<p className="font-light">
This site was created to demonstrate my mastery of Cedar: Look on my
works, ye mighty, and despair!
</p>
`

const BLOG_LAYOUT_BODY = `
const { logOut, isAuthenticated } = useAuth()

return (
  <>
    <header className="relative flex justify-between items-center py-4 px-8 bg-blue-700 text-white">
      <h1 className="text-3xl font-semibold tracking-tight">
        <Link
          className="text-blue-400 hover:text-blue-100 transition duration-100"
          to={routes.home()}
        >
          Cedar Blog
        </Link>
      </h1>
      <nav>
        <ul className="relative flex items-center font-light">
          <li>
            <NavLink
              className="py-2 px-4 hover:bg-blue-600 transition duration-100 rounded"
              activeClassName="py-2 px-4 hover:bg-blue-600 transition duration-100 rounded underline underline-offset-4"
              to={routes.about()}
            >
              About
            </NavLink>
          </li>
          <li>
            <NavLink
              className="py-2 px-4 hover:bg-blue-600 transition duration-100 rounded"
              activeClassName="py-2 px-4 hover:bg-blue-600 transition duration-100 rounded underline underline-offset-4"
              to={routes.contactUs()}
            >
              Contact Us
            </NavLink>
          </li>
          <li>
            <NavLink
              className="py-2 px-4 hover:bg-blue-600 transition duration-100 rounded"
              activeClassName="py-2 px-4 hover:bg-blue-600 transition duration-100 rounded underline underline-offset-4"
              to={routes.posts()}
            >
              Admin
            </NavLink>
          </li>
          {isAuthenticated && (
            <li>
              <NavLink
                className="py-2 px-4 hover:bg-blue-600 transition duration-100 rounded"
                activeClassName="py-2 px-4 hover:bg-blue-600 transition duration-100 rounded underline underline-offset-4"
                onClick={logOut}
                to={''}
              >
                Log Out
              </NavLink>
            </li>
          )}
          {!isAuthenticated && (
            <li>
              <NavLink
                className="py-2 px-4 hover:bg-blue-600 transition duration-100 rounded"
                activeClassName="py-2 px-4 hover:bg-blue-600 transition duration-100 rounded underline underline-offset-4"
                to={routes.login()}
              >
                Log In
              </NavLink>
            </li>
          )}
        </ul>
      </nav>
    </header>
    <main className="max-w-4xl mx-auto p-12 bg-white shadow-lg rounded-b mt-3">
      {children}
    </main>
  </>
)
`

const BLOG_POSTS_CELL_QUERY = `
  query BlogPostsQuery {
    blogPosts: posts {
      id
      title
      body
      author {
        email
        fullName
      }
      createdAt
    }
  }
`

const BLOG_POSTS_CELL_SUCCESS = `<div className="divide-y divide-grey-700">
{blogPosts.map((post) => <BlogPost key={post.id} blogPost={post} />)}
</div>`

const BLOG_POST_CELL_QUERY = `
  query FindBlogPostQuery($id: Int!) {
    blogPost: post(id: $id) {
      id
      title
      body
      author {
        email
        fullName
      }
      createdAt
    }
  }
`

const BLOG_POST_CELL_SUCCESS = `<BlogPost blogPost={blogPost} />`

const AUTHOR_COMPONENT_BODY = '<span>{author.fullName} ({author.email})</span>'

const CLASS_WITH_CLASS_FIELD_SOURCE = `class Bar {}

class Foo {
  // Without the correct babel plugins this will throw an error
  public bar = new Bar()
}

const ClassWithClassField = () => {
  return <p>{new Foo().bar.toString()}</p>
}

export default ClassWithClassField
`

function replaceOrThrow(
  source: string,
  searchValue: string | RegExp,
  replacement: string,
  errorMessage: string,
) {
  const nextSource = source.replace(searchValue, replacement)

  if (nextSource === source) {
    throw new Error(errorMessage)
  }

  return nextSource
}

function removeImportByModule(
  source: string,
  moduleSpecifier: string,
  { required = false }: { required?: boolean } = {},
) {
  const escapedModuleSpecifier = moduleSpecifier.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  )
  const importRegex = new RegExp(
    `^import .* from ['"]${escapedModuleSpecifier}['"]\\r?\\n`,
    'gm',
  )
  const nextSource = source.replace(importRegex, '')

  if (required && nextSource === source) {
    throw new Error(`Could not find import for ${moduleSpecifier}`)
  }

  return nextSource
}

function insertImportBeforeFirstImportOrThrow(
  source: string,
  importStatement: string,
  errorMessage: string,
) {
  if (source.includes(importStatement)) {
    return source
  }

  const importRegex = /^import .*$/m
  const match = source.match(importRegex)

  if (match?.index !== undefined) {
    return (
      source.slice(0, match.index) +
      importStatement +
      '\n' +
      source.slice(match.index)
    )
  }

  const componentRegex = /const \w+(Page|Layout|Cell|Component) =/
  const componentMatch = source.match(componentRegex)

  if (componentMatch?.index === undefined) {
    throw new Error(errorMessage)
  }

  return (
    source.slice(0, componentMatch.index) +
    importStatement +
    '\n\n' +
    source.slice(componentMatch.index)
  )
}

function insertImportAfterLastImportOrThrow(
  source: string,
  importStatement: string,
  errorMessage: string,
) {
  if (source.includes(importStatement)) {
    return source
  }

  const importRegex = /^import .*$/gm
  const matches = [...source.matchAll(importRegex)]
  const lastMatch = matches.at(-1)

  if (lastMatch?.index !== undefined) {
    const insertAt = lastMatch.index + lastMatch[0].length

    return (
      source.slice(0, insertAt) +
      '\n' +
      importStatement +
      source.slice(insertAt)
    )
  }

  const componentRegex = /const \w+(Page|Layout|Cell|Component) =/
  const componentMatch = source.match(componentRegex)

  if (componentMatch?.index === undefined) {
    throw new Error(errorMessage)
  }

  return (
    source.slice(0, componentMatch.index) +
    importStatement +
    '\n\n' +
    source.slice(componentMatch.index)
  )
}

function transformHomePage(source: string) {
  let nextSource = removeImportByModule(source, '@cedarjs/web')
  nextSource = insertImportAfterLastImportOrThrow(
    nextSource,
    "import BlogPostsCell from 'src/components/BlogPostsCell'",
    'Could not find where to insert BlogPostsCell import',
  )

  return replaceOrThrow(
    nextSource,
    /return\s*\(\s*<>\s*[\s\S]*?\s*<\/>\s*\)/m,
    'return <BlogPostsCell />',
    'Could not replace HomePage body',
  )
}

function transformAboutPage(source: string) {
  const nextSource = removeImportByModule(source, '@cedarjs/web')

  return replaceOrThrow(
    nextSource,
    /return\s*\(\s*<>\s*[\s\S]*?\s*<\/>\s*\)/m,
    `return (${ABOUT_PAGE_BODY})`,
    'Could not replace AboutPage body',
  )
}

function transformBlogPostPage(source: string) {
  const nextSource = insertImportAfterLastImportOrThrow(
    source,
    "import BlogPostCell from 'src/components/BlogPostCell'",
    'Could not find where to insert BlogPostCell import',
  )

  const blogPostComponentPatterns = [
    /const BlogPostPage = \(\{ id \}: BlogPostPageProps\) => [\s\S]*?export default BlogPostPage/m,
    /const BlogPostPage = \(\{ id \}\) => [\s\S]*?export default BlogPostPage/m,
    /const BlogPostPage = \(\) => [\s\S]*?export default BlogPostPage/m,
    /const BlogPostPage = \(([^)]*)\) => [\s\S]*?export default BlogPostPage/m,
  ]

  for (const pattern of blogPostComponentPatterns) {
    const updatedSource = nextSource.replace(
      pattern,
      `const BlogPostPage = ({ id }: BlogPostPageProps) => ${BLOG_POST_PAGE_BODY}

export default BlogPostPage`,
    )

    if (updatedSource !== nextSource) {
      return updatedSource
    }
  }

  throw new Error('Could not replace BlogPostPage component')
}

function transformBlogLayout(source: string) {
  let nextSource = insertImportBeforeFirstImportOrThrow(
    source,
    "import { Link, NavLink, routes } from '@cedarjs/router'",
    'Could not find where to insert BlogLayout router import',
  )
  nextSource = insertImportBeforeFirstImportOrThrow(
    nextSource,
    "import { useAuth } from 'src/auth'",
    'Could not find where to insert BlogLayout useAuth import',
  )

  return replaceOrThrow(
    nextSource,
    /const BlogLayout = \(\{ children \}: BlogLayoutProps\) => \{[\s\S]*?^}\n\nexport default BlogLayout/m,
    `const BlogLayout = ({ children }: BlogLayoutProps) => {${BLOG_LAYOUT_BODY}
}

export default BlogLayout`,
    'Could not replace BlogLayout component',
  )
}

function transformBlogPostsCell(source: string) {
  let nextSource = insertImportBeforeFirstImportOrThrow(
    source,
    "import BlogPost from 'src/components/BlogPost'",
    'Could not find where to insert BlogPost import in BlogPostsCell',
  )

  nextSource = replaceOrThrow(
    nextSource,
    /export const QUERY: TypedDocumentNode<BlogPostsQuery, BlogPostsQueryVariables> = gql`\n[\s\S]*?`\n/m,
    `export const QUERY: TypedDocumentNode<BlogPostsQuery, BlogPostsQueryVariables> = gql\`${BLOG_POSTS_CELL_QUERY}\`\n`,
    'Could not replace BlogPostsCell QUERY',
  )

  return replaceOrThrow(
    nextSource,
    /export const Success = \(\{\s*blogPosts,\s*}: CellSuccessProps<BlogPostsQuery, BlogPostsQueryVariables>\) => \{[\s\S]*?^}\n/m,
    `export const Success = ({
  blogPosts,
}: CellSuccessProps<BlogPostsQuery, BlogPostsQueryVariables>) => {
  return (${BLOG_POSTS_CELL_SUCCESS})
}
`,
    'Could not replace BlogPostsCell Success',
  )
}

function transformBlogPostCell(source: string) {
  let nextSource = insertImportBeforeFirstImportOrThrow(
    source,
    "import BlogPost from 'src/components/BlogPost'",
    'Could not find where to insert BlogPost import in BlogPostCell',
  )

  nextSource = replaceOrThrow(
    nextSource,
    /export const QUERY: TypedDocumentNode<FindBlogPostQuery, FindBlogPostQueryVariables> = gql`\n[\s\S]*?`\n/m,
    `export const QUERY: TypedDocumentNode<FindBlogPostQuery, FindBlogPostQueryVariables> = gql\`${BLOG_POST_CELL_QUERY}\`\n`,
    'Could not replace BlogPostCell QUERY',
  )

  return replaceOrThrow(
    nextSource,
    /export const Success = \(\{\s*blogPost,\s*}: CellSuccessProps<FindBlogPostQuery, FindBlogPostQueryVariables>\) => \{[\s\S]*?^}\n/m,
    `export const Success = ({
  blogPost,
}: CellSuccessProps<FindBlogPostQuery, FindBlogPostQueryVariables>) => {
  return ${BLOG_POST_CELL_SUCCESS}
}
`,
    'Could not replace BlogPostCell Success',
  )
}

function transformAuthor(source: string, target: string) {
  if (target.endsWith('.tsx')) {
    return `interface Props {
  author: {
    email: string
    fullName: string
  }
}

const Author = ({ author }: Props) => {
  return ${AUTHOR_COMPONENT_BODY}
}

export default Author
`
  }

  return `const Author = ({ author }) => {
  return ${AUTHOR_COMPONENT_BODY}
}

export default Author
`
}

function transformClassWithClassField() {
  return CLASS_WITH_CLASS_FIELD_SOURCE
}

function transformUsersSdl(source: string) {
  return source
    .split('\n')
    .map((line) => {
      if (
        line.includes('hashedPassword:') ||
        line.includes('salt:') ||
        line.includes('resetToken:') ||
        line.includes('resetTokenExpiresAt:')
      ) {
        return undefined
      }

      if (line.trim() === 'users: [User!]! @requireAuth') {
        return '    user(id: String!): User @skipAuth'
      }

      return line
    })
    .filter((line): line is string => line !== undefined)
    .join('\n')
}

function transformProfilePage(source: string) {
  const nextSource = insertImportAfterLastImportOrThrow(
    source,
    "import { useAuth } from 'src/auth'",
    'Could not find where to insert useAuth import',
  )

  return replaceOrThrow(
    nextSource,
    /const ProfilePage = \(\) => [\s\S]*?export default ProfilePage/m,
    `const ProfilePage = () => ${PROFILE_PAGE_BODY}

export default ProfilePage`,
    'Could not replace ProfilePage component',
  )
}

function transformWaterfallPage(source: string) {
  let nextSource = removeImportByModule(source, '@cedarjs/web')
  nextSource = insertImportAfterLastImportOrThrow(
    nextSource,
    "import WaterfallBlogPostCell from 'src/components/WaterfallBlogPostCell'",
    'Could not find where to insert WaterfallBlogPostCell import',
  )

  const waterfallComponentPatterns = [
    /const WaterfallPage = \(\{ id \}: WaterfallPageProps\) => [\s\S]*?export default WaterfallPage/m,
    /const WaterfallPage = \(\{ id \}\) => [\s\S]*?export default WaterfallPage/m,
    /const WaterfallPage = \(\) => [\s\S]*?export default WaterfallPage/m,
    /const WaterfallPage = \(([^)]*)\) => [\s\S]*?export default WaterfallPage/m,
  ]

  for (const pattern of waterfallComponentPatterns) {
    const updatedSource = nextSource.replace(
      pattern,
      `const WaterfallPage = ({ id }: WaterfallPageProps) => ${WATERFALL_PAGE_BODY}

export default WaterfallPage`,
    )

    if (updatedSource !== nextSource) {
      return updatedSource
    }
  }

  throw new Error('Could not replace WaterfallPage component')
}

function transformUsersService(source: string) {
  let nextSource = replaceOrThrow(
    source,
    /export const users:[\s\S]*?\n}\n/m,
    '',
    'Could not remove users service function',
  )

  nextSource = nextSource.replace(/\nexport \{\}\n/, '\n')

  return nextSource
}

function transformScenarioValueSuffix(source: string) {
  return source
    .split('\n')
    .map((line, index) => {
      const lineNumber = index + 1

      return line
        .replace(/String\d+/g, `String${lineNumber}`)
        .replace(/foo\d+@bar\.com/g, `foo${lineNumber}@bar.com`)
    })
    .join('\n')
}

function transformBlogPostPageStories(source: string) {
  return replaceOrThrow(
    source,
    /export const Primary: Story = \{\}/,
    BLOG_POST_PAGE_STORY_RENDER.trimEnd(),
    'Could not replace Primary story in BlogPostPage stories',
  )
}

function transformWaterfallPageStories(source: string) {
  return replaceOrThrow(
    source,
    /export const Primary: Story = \{\}/,
    WATERFALL_PAGE_STORY_RENDER.trimEnd(),
    'Could not replace Primary story in WaterfallPage stories',
  )
}

function applyStringTransform(codemod: string, target: string) {
  const source = fs.readFileSync(target, 'utf-8')

  let nextSource = source

  switch (codemod) {
    case 'homePage.js': {
      nextSource = transformHomePage(source)
      break
    }
    case 'aboutPage.js': {
      nextSource = transformAboutPage(source)
      break
    }
    case 'blogPostPage.js': {
      nextSource = transformBlogPostPage(source)
      break
    }
    case 'blogLayout.js': {
      nextSource = transformBlogLayout(source)
      break
    }
    case 'blogPostsCell.js': {
      nextSource = transformBlogPostsCell(source)
      break
    }
    case 'blogPostCell.js': {
      nextSource = transformBlogPostCell(source)
      break
    }
    case 'author.js': {
      nextSource = transformAuthor(source, target)
      break
    }
    case 'classWithClassField.ts': {
      nextSource = transformClassWithClassField()
      break
    }
    case 'usersSdl.js': {
      nextSource = transformUsersSdl(source)
      break
    }
    case 'profilePage.js': {
      nextSource = transformProfilePage(source)
      break
    }
    case 'waterfallPage.js': {
      nextSource = transformWaterfallPage(source)
      break
    }
    case 'usersService.js': {
      nextSource = transformUsersService(source)
      break
    }
    case 'scenarioValueSuffix.js': {
      nextSource = transformScenarioValueSuffix(source)
      break
    }
    case 'updateBlogPostPageStories.js': {
      nextSource = transformBlogPostPageStories(source)
      break
    }
    case 'updateWaterfallPageStories.js': {
      nextSource = transformWaterfallPageStories(source)
      break
    }
    default: {
      return false
    }
  }

  fs.writeFileSync(target, nextSource)

  return true
}

export async function applyCodemod(codemod: string, target: string) {
  if (applyStringTransform(codemod, target)) {
    return { stdout: '', stderr: '', exitCode: 0 }
  }

  const args = [
    '--fail-on-error',
    '-t',
    `${path.resolve(__dirname, 'codemods', codemod)} ${target}`,
    '--parser',
    'tsx',
    '--verbose=2',
  ]

  args.push()

  const subprocess = exec(
    'yarn jscodeshift',
    args,
    getExecaOptions(path.resolve(import.meta.dirname)),
  )

  return subprocess
}

export const getExecaOptions = (
  cwd: string,
  stdio: 'inherit' | 'pipe' = 'pipe',
): ExecaOptions => ({
  shell: true,
  stdio,
  cleanup: true,
  cwd,
  env: {
    RW_PATH: path.join(__dirname, '../../'),
    CFW_PATH: path.join(__dirname, '../../'),
    RWFW_PATH: path.join(__dirname, '../../'),
  },
})

export const updatePkgJsonScripts = ({
  projectPath,
  scripts,
}: {
  projectPath: string
  scripts: Record<string, string>
}) => {
  const projectPackageJsonPath = path.join(projectPath, 'package.json')
  const projectPackageJson = JSON.parse(
    fs.readFileSync(projectPackageJsonPath, 'utf-8'),
  )
  projectPackageJson.scripts = {
    ...projectPackageJson.scripts,
    ...scripts,
  }
  fs.writeFileSync(
    projectPackageJsonPath,
    JSON.stringify(projectPackageJson, undefined, 2),
  )
}

// Confirmation prompt when using --no-copyFromFixture --no-link'
export async function confirmNoFixtureNoLink(
  copyFromFixtureOption: boolean,
  linkOption: boolean,
) {
  if (!copyFromFixtureOption && !linkOption) {
    const { checkNoLink } = await prompts(
      {
        type: 'confirm',
        name: 'checkNoLink',
        message:
          'WARNING: You are building a raw project without the `--link` option.' +
          '\nThe new test-project will NOT build with templates from this branch.' +
          '\nInstead it will build using latest release generator template code.' +
          '\nIf not intended, exit and add the `--link` option.' +
          '\nOtherwise, enter "(y)es" to continue:',
      },
      {
        onCancel: () => {
          process.exit(1)
        },
      },
    )
    return checkNoLink
  }
}

export class ExecaError extends Error {
  stdout: string
  stderr: string
  exitCode: number

  constructor({
    stdout,
    stderr,
    exitCode,
  }: {
    stdout: string
    stderr: string
    exitCode: number
  }) {
    super(`execa failed with exit code ${exitCode}`)
    this.stdout = stdout
    this.stderr = stderr
    this.exitCode = exitCode
  }
}

export async function exec(
  file: string,
  args?: string[],
  options?: ExecaOptions,
) {
  return execa(file, args ?? [], options)
    .then(({ stdout, stderr, exitCode }) => {
      if (exitCode !== 0) {
        throw new ExecaError({ stdout, stderr, exitCode })
      }

      return { stdout, stderr, exitCode }
    })
    .catch((error) => {
      if (error instanceof ExecaError) {
        // Rethrow ExecaError
        throw error
      } else {
        const { stdout = '', stderr = '', exitCode = 1 } = error
        throw new ExecaError({ stdout, stderr, exitCode })
      }
    })
}

// TODO: Remove this as soon as cfw is part of a stable Cedar release, and then
// instead just use `cfw` directly everywhere
export function getCfwBin(projectPath: string) {
  return fs.existsSync(path.join(projectPath, 'node_modules/.bin/cfw'))
    ? 'cfw'
    : 'rwfw'
}

export async function addModel(model: string) {
  const prismaPath = `${getOutputPath()}/api/db/schema.prisma`
  const schema = await fs.promises.readFile(prismaPath, 'utf-8')

  return fs.promises.writeFile(prismaPath, `${schema.trim()}\n\n${model}\n`)
}

/**
 * @param cmd The command to run
 */
export function createBuilder(cmd: string, dir = '') {
  const execaOptions = getExecaOptions(path.join(getOutputPath(), dir))

  return async function createItem(positionals?: string | string[]) {
    const args = positionals
      ? Array.isArray(positionals)
        ? positionals
        : [positionals]
      : []
    return execa(cmd, args, execaOptions)
  }
}
