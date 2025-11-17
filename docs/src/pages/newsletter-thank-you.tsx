import React from 'react'

import Head from '@docusaurus/Head'
import Link from '@docusaurus/Link'
import Layout from '@theme/Layout'

export default function ThankYou() {
  return (
    <Layout
      description={
        'Thank you for subscribing to the CedarJS newsletter! ' +
        'Stay updated with the latest news, features, and updates.'
      }
    >
      <Head>
        <title>Thank You | CedarJS Newsletter</title>
        <meta property="og:title" content="Thank You | CedarJS Newsletter" />
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
            alt="CedarJS Logo"
          />
          <h1 style={{ textAlign: 'center', marginTop: '1em' }}>
            Thank You for Subscribing!
          </h1>
          <p
            style={{ fontSize: '1.2em', maxWidth: '600px', margin: '1em auto' }}
          >
            You&apos;re now subscribed to the CedarJS newsletter. We&apos;ll
            keep you updated with the latest news, features, releases, and
            community highlights.
          </p>
        </section>

        <section style={{ marginTop: '3em' }}>
          <h2>What&apos;s Next?</h2>
          <ul style={{ fontSize: '1.1em', lineHeight: '1.8' }}>
            <li>
              <strong>Join the community</strong> – Connect with other
              developers on our{' '}
              <a
                href="https://cedarjs.com/discord"
                target="_blank"
                rel="noopener noreferrer"
              >
                Discord server
              </a>
              .
            </li>
            <li>
              <strong>Explore the docs</strong> – Get started with CedarJS by
              reading our <Link to="/docs">comprehensive documentation</Link>.
            </li>
            <li>
              <strong>Star us on GitHub</strong> – Show your support by starring
              the{' '}
              <a
                href="https://github.com/cedarjs/cedar"
                target="_blank"
                rel="noopener noreferrer"
              >
                CedarJS repository
              </a>
              .
            </li>
          </ul>
        </section>

        <section style={{ marginTop: '3em', textAlign: 'center' }}>
          <h2>Get Started with CedarJS</h2>
          <p style={{ fontSize: '1.1em', marginBottom: '1.5em' }}>
            Ready to build something amazing? Create your first CedarJS app now:
          </p>
          <div
            style={{
              backgroundColor: 'var(--ifm-code-background)',
              border: '1px solid var(--ifm-color-emphasis-300)',
              padding: '1em',
              borderRadius: '6px',
              fontFamily: 'monospace',
              fontSize: '1.1em',
              marginBottom: '1.5em',
            }}
          >
            yarn create cedar-app my-app
          </div>
          <p>
            <Link
              to="/docs"
              style={{
                display: 'inline-block',
                padding: '12px 24px',
                backgroundColor: '#3ECC5F',
                color: 'white',
                borderRadius: '6px',
                textDecoration: 'none',
                fontWeight: 'bold',
                fontSize: '1.1em',
              }}
            >
              View Documentation
            </Link>
          </p>
        </section>

        <section style={{ marginTop: '3em', textAlign: 'center' }}>
          <p>
            <Link to="/">← Back to Home</Link>
          </p>
        </section>
      </div>
    </Layout>
  )
}
