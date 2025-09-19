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
          CedarJS is a fork of the <a href="https://redwoodjs.com">RedwoodJS</a>{' '}
          framework with the goal of taking it into the modern web development
          era with a smooth transition path for existing RedwoodJS applications.
        </p>
        <p>
          CedarJS is a reliable, modern, and actively maintained full-stack
          React framework used in production by both large and small companies.
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
