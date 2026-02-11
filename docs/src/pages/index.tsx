import React, { useCallback, useMemo, useState } from 'react'

import Head from '@docusaurus/Head'
import Link from '@docusaurus/Link'
import useBaseUrl from '@docusaurus/useBaseUrl'
import Layout from '@theme/Layout'

import styles from './styles.module.css'

const createCommand = 'yarn create cedar-app'

const cliLines = [
  '$ yarn cedar generate service post',
  '✔ Created api/src/services/posts/posts.ts',
  '✔ Created api/src/graphql/posts.sdl.ts',
  '✔ Added types to types/graphql.d.ts',
]

const serviceCode = (
  <>
    <span className={styles.tokenKeyword}>import</span>{' '}
    <span className={styles.tokenKeyword}>type</span>{' '}
    <span className={styles.tokenPunctuation}>{'{'}</span>
    {'\n'} <span className={styles.tokenType}>QueryResolvers</span>,{'\n'}{' '}
    <span className={styles.tokenType}>MutationResolvers</span>,{'\n'}{' '}
    <span className={styles.tokenType}>PostRelationResolvers</span>,{'\n'}
    <span className={styles.tokenPunctuation}>{'}'}</span>{' '}
    <span className={styles.tokenKeyword}>from</span>{' '}
    <span className={styles.tokenString}>&apos;types/graphql&apos;</span>
    {'\n\n'}
    <span className={styles.tokenKeyword}>import</span>{' '}
    <span className={styles.tokenPunctuation}>{'{'}</span>{' '}
    <span className={styles.tokenVariable}>db</span>{' '}
    <span className={styles.tokenPunctuation}>{'}'}</span>{' '}
    <span className={styles.tokenKeyword}>from</span>{' '}
    <span className={styles.tokenString}>&apos;src/lib/db&apos;</span>
    {'\n\n'}
    <span className={styles.tokenKeyword}>export</span>{' '}
    <span className={styles.tokenKeyword}>const</span>{' '}
    <span className={styles.tokenFunction}>posts</span>
    <span className={styles.tokenPunctuation}>:</span>{' '}
    <span className={styles.tokenType}>QueryResolvers</span>
    <span className={styles.tokenPunctuation}>[</span>
    <span className={styles.tokenString}>&apos;posts&apos;</span>
    <span className={styles.tokenPunctuation}>]</span>{' '}
    <span className={styles.tokenOperator}>=</span>{' '}
    <span className={styles.tokenPunctuation}>(</span>
    <span className={styles.tokenPunctuation}>)</span>{' '}
    <span className={styles.tokenOperator}>=&gt;</span>{' '}
    <span className={styles.tokenPunctuation}>{'{'}</span>
    {'\n'} <span className={styles.tokenKeyword}>return</span>{' '}
    <span className={styles.tokenVariable}>db</span>
    <span className={styles.tokenPunctuation}>.</span>
    <span className={styles.tokenFunction}>post</span>
    <span className={styles.tokenPunctuation}>.</span>
    <span className={styles.tokenFunction}>findMany</span>
    <span className={styles.tokenPunctuation}>(</span>
    <span className={styles.tokenPunctuation}>)</span>
    {'\n'}
    <span className={styles.tokenPunctuation}>{'}'}</span>
    {'\n\n'}
    <span className={styles.tokenKeyword}>export</span>{' '}
    <span className={styles.tokenKeyword}>const</span>{' '}
    <span className={styles.tokenFunction}>createPost</span>
    <span className={styles.tokenPunctuation}>:</span>{' '}
    <span className={styles.tokenType}>MutationResolvers</span>
    <span className={styles.tokenPunctuation}>[</span>
    <span className={styles.tokenString}>&apos;createPost&apos;</span>
    <span className={styles.tokenPunctuation}>]</span>{' '}
    <span className={styles.tokenOperator}>=</span>
    {'\n'} <span className={styles.tokenPunctuation}>(</span>
    <span className={styles.tokenPunctuation}>{'{'}</span>{' '}
    <span className={styles.tokenVariable}>input</span>{' '}
    <span className={styles.tokenPunctuation}>{'}'}</span>
    <span className={styles.tokenPunctuation}>)</span>{' '}
    <span className={styles.tokenOperator}>=&gt;</span>{' '}
    <span className={styles.tokenPunctuation}>{'{'}</span>
    {'\n'} <span className={styles.tokenKeyword}>return</span>{' '}
    <span className={styles.tokenVariable}>db</span>
    <span className={styles.tokenPunctuation}>.</span>
    <span className={styles.tokenFunction}>post</span>
    <span className={styles.tokenPunctuation}>.</span>
    <span className={styles.tokenFunction}>create</span>
    <span className={styles.tokenPunctuation}>(</span>
    <span className={styles.tokenPunctuation}>{'{'}</span>
    {'\n'} <span className={styles.tokenProperty}>data</span>
    <span className={styles.tokenPunctuation}>:</span>{' '}
    <span className={styles.tokenVariable}>input</span>
    <span className={styles.tokenPunctuation}>,</span>
    {'\n'} <span className={styles.tokenPunctuation}>{'}'}</span>
    <span className={styles.tokenPunctuation}>)</span>
    {'\n'} <span className={styles.tokenPunctuation}>{'}'}</span>
  </>
)

const sdlCode = (
  <>
    <span className={styles.tokenKeyword}>export</span>{' '}
    <span className={styles.tokenKeyword}>const</span>{' '}
    <span className={styles.tokenVariable}>schema</span>{' '}
    <span className={styles.tokenOperator}>=</span>{' '}
    <span className={styles.tokenFunction}>gql</span>
    <span className={styles.tokenString}>{'`'}</span>
    {'\n  '}
    <span className={styles.tokenKeyword}>type</span>{' '}
    <span className={styles.tokenType}>Post</span>{' '}
    <span className={styles.tokenPunctuation}>{'{'}</span>
    {'\n    '}
    <span className={styles.tokenProperty}>id</span>
    <span className={styles.tokenPunctuation}>:</span>{' '}
    <span className={styles.tokenType}>Int</span>
    <span className={styles.tokenPunctuation}>!</span>
    {'\n    '}
    <span className={styles.tokenProperty}>title</span>
    <span className={styles.tokenPunctuation}>:</span>{' '}
    <span className={styles.tokenType}>String</span>
    <span className={styles.tokenPunctuation}>!</span>
    {'\n    '}
    <span className={styles.tokenProperty}>body</span>
    <span className={styles.tokenPunctuation}>:</span>{' '}
    <span className={styles.tokenType}>String</span>
    <span className={styles.tokenPunctuation}>!</span>
    {'\n    '}
    <span className={styles.tokenProperty}>author</span>
    <span className={styles.tokenPunctuation}>:</span>{' '}
    <span className={styles.tokenType}>User</span>
    <span className={styles.tokenPunctuation}>!</span>
    {'\n  '}
    <span className={styles.tokenPunctuation}>{'}'}</span>
    {'\n\n  '}
    <span className={styles.tokenKeyword}>type</span>{' '}
    <span className={styles.tokenType}>Query</span>{' '}
    <span className={styles.tokenPunctuation}>{'{'}</span>
    {'\n    '}
    <span className={styles.tokenProperty}>posts</span>
    <span className={styles.tokenPunctuation}>:</span>{' '}
    <span className={styles.tokenPunctuation}>[</span>
    <span className={styles.tokenType}>Post</span>
    <span className={styles.tokenPunctuation}>!</span>
    <span className={styles.tokenPunctuation}>]</span>
    <span className={styles.tokenPunctuation}>!</span>{' '}
    <span className={styles.tokenDirective}>@skipAuth</span>
    {'\n  '}
    <span className={styles.tokenPunctuation}>{'}'}</span>
    {'\n\n  '}
    <span className={styles.tokenKeyword}>type</span>{' '}
    <span className={styles.tokenType}>Mutation</span>{' '}
    <span className={styles.tokenPunctuation}>{'{'}</span>
    {'\n    '}
    <span className={styles.tokenProperty}>createPost</span>
    <span className={styles.tokenPunctuation}>(</span>
    <span className={styles.tokenProperty}>input</span>
    <span className={styles.tokenPunctuation}>:</span>{' '}
    <span className={styles.tokenType}>CreatePostInput</span>
    <span className={styles.tokenPunctuation}>!</span>
    <span className={styles.tokenPunctuation}>)</span>
    <span className={styles.tokenPunctuation}>:</span>{' '}
    <span className={styles.tokenType}>Post</span>
    <span className={styles.tokenPunctuation}>!</span>
    {'\n      '}
    <span className={styles.tokenDirective}>@requireAuth</span>
    {'\n  '}
    <span className={styles.tokenPunctuation}>{'}'}</span>
    {'\n'}
    <span className={styles.tokenString}>{'`'}</span>
  </>
)

type LogoCardProps = {
  label: string
  href?: string
  logoSrc?: string
  className?: string
}

function LogoCard({ label, href, logoSrc, className }: LogoCardProps) {
  const content = (
    <>
      {logoSrc ? (
        <img
          className={`${styles.logoImage} ${className ?? ''}`}
          src={logoSrc}
          alt={`${label} logo`}
        />
      ) : (
        <svg viewBox="0 0 120 48" role="img" aria-hidden="true">
          <rect x="2" y="2" width="116" height="44" rx="12" />
          <path d="M16 32 L32 16 L48 32" />
          <circle cx="88" cy="24" r="6" />
        </svg>
      )}
      <span>{label}</span>
    </>
  )

  return (
    <div className={styles.logoCard} aria-label={`${label} logo`}>
      {href ? (
        <a href={href} aria-label={label}>
          {content}
        </a>
      ) : (
        content
      )}
    </div>
  )
}

export default function Home() {
  const [copied, setCopied] = useState(false)
  const aerafarmsLogo = useBaseUrl('/img/sponsors/aera-logo.png')
  const acmLogo = useBaseUrl('/img/sponsors/acm_se-logo.png')

  const codeBlocks = useMemo(
    () => [
      { label: 'posts.service.ts', code: serviceCode },
      { label: 'posts.sdl.ts', code: sdlCode },
    ],
    []
  )

  const onCopy = useCallback(async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(createCommand)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch (error) {
      console.error('Failed to copy command', error)
    }
  }, [])

  return (
    <Layout
      description={
        'CedarJS is a stable, opinionated full-stack framework that integrates React, GraphQL, and Prisma into a cohesive system.'
      }
    >
      <Head>
        <title>CedarJS | Production-Ready Full-Stack Framework</title>
        <meta
          property="og:title"
          content="CedarJS | Production-Ready Full-Stack Framework"
        />
      </Head>
      <div className={styles.page}>
        <div className={styles.backdrop} aria-hidden="true" />
        <header className={styles.navbar}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>CedarJS</span>
          </div>
          <nav className={styles.navLinks}>
            <Link to="/docs">Documentation</Link>
            <Link to="/docs/tutorial/foreword">Tutorial</Link>
            <a href="https://github.com/cedarjs/cedar">GitHub</a>
            <a href="https://github.com/sponsors/cedarjs">Sponsor</a>
          </nav>
        </header>

        <main className={styles.container}>
          <section className={styles.hero}>
            <div>
              <p className={styles.eyebrow}>
                Production-ready full-stack framework
              </p>
              <h1 className={styles.headline}>
                Stop gluing libraries together. Start building your product.
              </h1>
              <p className={styles.subhead}>
                CedarJS is a stable, opinionated full-stack framework that
                integrates React, GraphQL, and Prisma into a cohesive system.
                Don&apos;t waste weeks on boilerplate—use the foundation trusted
                for production-grade applications.
              </p>
              <div className={styles.heroActions}>
                <Link
                  className={styles.secondaryCta}
                  to="/docs/tutorial/foreword"
                >
                  Start the Tutorial
                </Link>
                <div className={styles.commandCard}>
                  <span className={styles.commandPrompt}>$</span>
                  <code className={styles.commandText}>{createCommand}</code>
                  <button
                    className={styles.copyButton}
                    onClick={onCopy}
                    type="button"
                    aria-label="Copy create command"
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <p className={styles.commandHint}>
                Start with a cohesive stack and scale without rewrites.
              </p>
            </div>
            <div className={styles.heroPanel}>
              <div className={styles.terminal}>
                <div className={styles.terminalHeader}>
                  <span />
                  <span />
                  <span />
                  <strong>cedar</strong>
                </div>
                <div className={styles.terminalBody}>
                  {cliLines.map((line, index) => (
                    <div className={styles.cliLine} key={line}>
                      <span
                        style={{ animationDelay: `${0.3 + index * 0.25}s` }}
                      >
                        {line}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.heroStats}>
                <div>
                  <strong>React + GraphQL + Prisma</strong>
                  <span>Integrated by default.</span>
                </div>
                <div>
                  <strong>Services = Resolvers</strong>
                  <span>No manual wiring.</span>
                </div>
                <div>
                  <strong>Production-first</strong>
                  <span>Maintainable by design.</span>
                </div>
              </div>
            </div>
          </section>

          <section className={styles.trustBar}>
            <p>
              Built for the long haul. Sponsored and used in production by
              industry leaders.
            </p>
            <div className={styles.logos}>
              <LogoCard
                label="TwoDots"
                href="https://twodots.net"
                logoSrc="https://github.com/user-attachments/assets/a98ae112-9f66-4c0a-a450-fa410725b230"
                className={styles.logoRounded}
              />
              <LogoCard
                label="Aerafarms"
                href="https://aerafarms.com"
                logoSrc={aerafarmsLogo}
              />
              <LogoCard
                label="Rho Impact"
                href="https://rhoimpact.com/"
                logoSrc="https://github.com/user-attachments/assets/1eef45f4-e5a4-42a8-b98e-7ee1b711dc4b"
              />
              <LogoCard
                label="ACM"
                href="https://acm.se"
                logoSrc={acmLogo}
                className={`${styles.logoOnLight} ${styles.logoRounded}`}
              />
            </div>
          </section>

          <section className={styles.splitSection}>
            <div className={styles.splitIntro}>
              <h2>The Cedar Way: Generators that ship real code.</h2>
              <p>
                The CLI captures architecture decisions so you never have to
                assemble boilerplate by hand. Generate a service, and Cedar
                produces resolvers, schemas, and type safety in one sweep.
              </p>
            </div>
            <div className={styles.splitGrid}>
              <div className={styles.cliPanel}>
                <div className={styles.panelLabel}>CLI</div>
                <div className={styles.terminalBody}>
                  {cliLines.map((line, index) => (
                    <div className={styles.cliLine} key={`${line}-panel`}>
                      <span
                        style={{ animationDelay: `${0.4 + index * 0.25}s` }}
                      >
                        {line}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.codePanel}>
                {codeBlocks.map((block) => (
                  <div className={styles.codeBlock} key={block.label}>
                    <div className={styles.panelLabel}>{block.label}</div>
                    <pre>
                      <code>{block.code}</code>
                    </pre>
                  </div>
                ))}
              </div>
            </div>
            <p className={styles.caption}>
              In Cedar, your business logic lives in <strong>Services</strong>.
              They automatically act as your GraphQL resolvers, providing a
              clean, typesafe bridge between your database and your UI without
              manual wiring.
            </p>
            <div className={styles.ctaStrip}>
              <span>Ready to generate your first service?</span>
              <div className={styles.inlineCommand}>
                <code className={styles.inlineCode}>{createCommand}</code>
                <button
                  className={styles.inlineCopy}
                  type="button"
                  onClick={onCopy}
                  aria-label="Copy create command"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </section>

          <section className={styles.benefits}>
            <h2>The Cedar Edge</h2>
            <div className={styles.benefitGrid}>
              <article>
                <h3>Stability over Hype</h3>
                <p>
                  Build on proven patterns. CedarJS leverages React and GraphQL
                  within a predictable, production-tested architecture that
                  prioritizes long-term maintainability.
                </p>
              </article>
              <article>
                <h3>Integrated Infrastructure</h3>
                <p>
                  Auth, Recurring Jobs, and Mailers are first-class
                  citizens—core components designed to work together out of the
                  box.
                </p>
              </article>
              <article>
                <h3>Production-Ready Observability</h3>
                <p>
                  Scale with confidence. The Cedar CLI includes dedicated setup
                  commands for <strong>OpenTelemetry</strong> and{' '}
                  <strong>Sentry</strong>, so monitoring is ready when you are.
                </p>
              </article>
            </div>
            <div className={styles.ctaStrip}>
              <span>Start with the foundation teams trust.</span>
              <div className={styles.inlineCommand}>
                <code className={styles.inlineCode}>{createCommand}</code>
                <button
                  className={styles.inlineCopy}
                  type="button"
                  onClick={onCopy}
                  aria-label="Copy create command"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </section>

          <section className={styles.aiSection}>
            <div>
              <h2>The Framework for the AI Era.</h2>
              <p>
                Because CedarJS uses a strict, predictable directory structure
                and a standard CLI, AI agents don&apos;t have to guess your
                architecture. They can generate feature-complete services,
                mailers, and jobs that work perfectly the first time. Cedar
                isn&apos;t just easy for humans to read—it&apos;s optimized for
                the LLMs you use every day.
              </p>
              <Link
                className={styles.secondaryCta}
                to="/docs/tutorial/foreword"
              >
                Start the Tutorial
              </Link>
            </div>
            <div className={styles.aiCard}>
              <div>
                <strong>Predictable Structure</strong>
                <span>Standardized paths every agent can follow.</span>
              </div>
              <div>
                <strong>Typed by Default</strong>
                <span>Services emit GraphQL types automatically.</span>
              </div>
              <div>
                <strong>CLI as Source of Truth</strong>
                <span>Generators produce repeatable outcomes.</span>
              </div>
            </div>
          </section>
        </main>

        <footer className={styles.footer}>
          <div className={styles.footerCta}>
            <h3>Ship with CedarJS today.</h3>
            <div className={styles.inlineCommand}>
              <code className={styles.inlineCode}>{createCommand}</code>
              <button
                className={styles.inlineCopy}
                type="button"
                onClick={onCopy}
                aria-label="Copy create command"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div className={styles.footerGrid}>
            <div>
              <h4>Migrate to Cedar</h4>
              <a href="https://cedarjs.com/docs/upgrade-guides/redwood-to-cedar/">
                From RedwoodJS
              </a>
            </div>
            <div>
              <h4>Community</h4>
              <a href="https://cedarjs.com/discord">Discord</a>
              <a href="https://twitter.com/cedarjs">Twitter/X</a>
            </div>
            <div>
              <h4>Resources</h4>
              <a href="/docs/reference">API Reference</a>
              <a href="/docs/cli-commands">CLI Docs</a>
              <a href="/docs/security">Security Policy</a>
              <a href="https://github.com/cedarjs/cedar/blob/main/LICENSE">
                LICENSE
              </a>
            </div>
          </div>
        </footer>
      </div>
    </Layout>
  )
}
