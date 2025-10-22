import React, { useEffect, useState } from 'react'

import Head from '@docusaurus/Head'
import Link from '@docusaurus/Link'
import useBaseUrl from '@docusaurus/useBaseUrl'
import Layout from '@theme/Layout'

import sidebars from '../../sidebars.js'

import styles from './styles.module.css'

export default function Home() {
  const [stargazerCount, setStargazerCount] = useState<number | string>('--')

  useEffect(() => {
    fetch('https://api.github.com/repos/cedarjs/cedar')
      .then((response) => response.json())
      .then((data) => {
        setStargazerCount(data.stargazers_count)
      })
      .catch((error) => {
        console.error('Error fetching startgazer count:', error)
        setStargazerCount('--')
      })
  }, [])

  return (
    <Layout
      description={
        'CedarJS is a reliable, modern, and actively maintained full-stack ' +
        "React framework. CedarJS's DX is unmatched by any other JavaScript " +
        'React + GraphQL framework.'
      }
    >
      <Head>
        <title>CedarJS | The React + GraphQL Web App Framework</title>
        <meta
          property="og:title"
          content="CedarJS | The React + GraphQL Web App Framework"
        />
      </Head>
      <div
        style={{
          maxWidth: '1024px',
          margin: '0 auto',
          padding: '2em',
        }}
      >
        <section style={{ textAlign: 'center' }}>
          <img
            src="https://avatars.githubusercontent.com/u/211931789?s=200&v=4"
            width="200"
          />
          <h1 style={{ textAlign: 'center' }}>CedarJS</h1>
          <p
            style={{
              display: 'flex',
              flexDirection: 'row',
              gap: '.5em',
              justifyContent: 'center',
            }}
          >
            <a href="https://cedarjs.com/discord">
              <img
                src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white"
                alt="Join our Discord server!"
              />
            </a>
            <a href="https://github.com/cedarjs/cedar">
              <img
                src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white"
                alt="GitHub page"
              />
            </a>
            <a href="/docs">
              <img
                src="https://img.shields.io/badge/Documentation-3ECC5F?style=for-the-badge&logo=readthedocs&logoColor=white"
                alt="Documentation"
              />
            </a>
          </p>
        </section>
        <h1>About</h1>
        <p>
          CedarJS is an opinionated, full-stack React framework that makes
          building web applications fast and enjoyable. It includes everything
          you need: React for the frontend, GraphQL for the API, Prisma for the
          database, and built-in support for authentication, testing, and
          deployment.
        </p>
        <p>
          CedarJS is a fork of the{' '}
          <a href="https://github.com/redwoodjs/graphql">RedwoodJS GraphQL</a>{' '}
          framework that is actively maintained and used in production by
          companies of all sizes. With active development focused on modern web
          standards and developer experience, Cedar is evolving with new
          features and improvements that aren&apos;t available in RedwoodJS.
        </p>
        <p>
          CedarJS would obviously not be where it is today without the vision
          and heroic efforts of the RedwoodJS founders, maintainers and
          community.
        </p>
        <blockquote>
          cedar has become a powerful symbol of strength and revitalization
          <cite style={{ display: 'block' }}>
            —{' '}
            <a href="https://indigenousfoundations.arts.ubc.ca/cedar/">
              https://indigenousfoundations.
              <wbr />
              arts.
              <wbr />
              ubc.ca/cedar/
            </a>
          </cite>
        </blockquote>
        <h1>Why Cedar?</h1>
        <h2>For RedwoodGraphQL (formerly RedwoodJS) Users</h2>
        <p>
          If you&apos;re currently using RedwoodGraphQL, here&apos;s why you
          might want to consider Cedar:
        </p>
        <ul>
          <li>
            Cedar is actively maintained by developers who use it in production
            daily. New features, bug fixes, and security updates are
            consistently delivered.
          </li>
          <li>
            Cedar includes improvements and features that aren&apos;t available
            in RedwoodJS, like{' '}
            <a href="https://cedarjs.com/docs/background-jobs/#recurring-jobs">
              Recurring Jobs
            </a>{' '}
            and{' '}
            <a href="https://github.com/cedarjs/cedar/tree/f824d9dbd87965fa96c9b7a06f62a14dc7f5b0a1/packages/create-cedar-app/templates/esm-ts">
              experimental ESM support
            </a>
            .
          </li>
          <li>
            Moving toward ESM-only packages and modern JavaScript standards to
            future-proof your applications.
          </li>
          <li>
            Cedar maintains backward compatibility with RedwoodJS v8.6, making
            migration straightforward with a clear upgrade path.
          </li>
        </ul>
        <h2>For Everyone Else</h2>
        <p>
          Whether you&apos;re building a startup MVP, a departmental tool, or a
          full production application, here&apos;s what you get with Cedar:
        </p>
        <ul>
          <li>
            Fast Setup. Get from zero to deployed application with a database in
            minutes, not days.
          </li>
          <li>
            An extensive CLI with generator and setup commands for most things
            you want to do. A dedicated CLI is faster and cheaper than asking AI
            to do it for you, and 100% predictable.
          </li>
          <li>
            Team empowerment. Keep your entire stack in TypeScript/JavaScript.
            No context switching between languages or separate teams for
            frontend and backend. Everyone is empowered to contribute across the
            entire application.
          </li>
          <li>
            Architectural decisions made for you, so you don&apos;t get stuck in
            analysis paralysis or get decision fatigue. But it doesn&apos;t lock
            you in. You have full control over your code, your auth, your
            database, and your deployment.
          </li>
          <li>
            Ready made integrations for hosting on Vercel, Netlify, AWS, Render,
            or your own servers. Switch providers easily without major rewrites.
          </li>
          <li>
            A production ready framework. Used by companies in production with a
            mature ecosystem and comprehensive documentation.
          </li>
          <li>
            You start with a working app that includes routing, database setup,
            and testing – all configured and ready to go. And if there&apos;s
            more you need, like authorization, there&apos;s most likely a setup
            command or a generator for it.
          </li>
        </ul>
        <h2>Who Is Cedar For?</h2>
        <p>
          <strong>Startups</strong> that need to move fast and iterate quickly.{' '}
          <strong>Solo developers</strong> who want to build full-stack apps
          without managing complex tooling. <strong>Development teams</strong>{' '}
          that value standardization and clear conventions.{' '}
          <strong>Companies</strong>
          transitioning from RedwoodJS or looking for an actively maintained
          full-stack framework with a dedicated API layer. Or just about{' '}
          <strong>anyone</strong> who wants to focus on building features rather
          than configuring build tools and infrastructure.
        </p>
        <div style={{ textAlign: 'center', marginBlock: '30px' }}>
          <p>Please star the project on GitHub!</p>
          <div className={styles.starButtonStyle}>
            <a
              href="https://github.com/cedarjs/cedar"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.starSectionStyle}
            >
              <img
                src={useBaseUrl('/img/github-star-small.png')}
                alt="Star"
                width="32"
                height="32"
                className={styles.starIcon}
              />
              Star
            </a>
            <a
              href="https://github.com/cedarjs/cedar/stargazers"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.countSectionStyle}
            >
              {stargazerCount}
            </a>
          </div>
        </div>
        <h1>Documentation</h1>
        <ul>
          {sidebars.main.map((section: string | Record<string, any>) => {
            const linkText =
              typeof section === 'string' ? toTitleCase(section) : section.label
            const linkTarget =
              typeof section === 'string'
                ? section
                : section.link?.slug?.replace(/^\//, '') ||
                  section.items?.at(0)?.id ||
                  section.items?.at(0)?.dirName

            return (
              <li key={linkTarget}>
                <Link to={'docs/' + linkTarget}>{linkText}</Link>
              </li>
            )
          })}
        </ul>
      </div>
    </Layout>
  )
}

function toTitleCase(str: string) {
  return str
    .replaceAll('-', ' ')
    .split(' ')
    .map((w) => w[0].toUpperCase() + w.substring(1))
    .join(' ')
}
