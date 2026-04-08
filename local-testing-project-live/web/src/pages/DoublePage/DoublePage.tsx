import { Metadata } from '@cedarjs/web'

import test from './test.png'

const DoublePage = () => {
  return (
    <>
      <Metadata title="Double" description="Double page" og />

      <h1 className="mb-1 mt-2 text-xl font-semibold">DoublePage</h1>
      <p>
        This page exists to make sure we don&apos;t regress on{' '}
        <a
          href="https://github.com/redwoodjs/redwood/issues/7757"
          className="text-blue-600 underline visited:text-purple-600 hover:text-blue-800"
          target="_blank"
          rel="noreferrer"
        >
          #7757
        </a>
      </p>
      <p>For RW#7757 it needs to be a page that is not wrapped in a Set</p>
      <p>
        We also use this page to make sure we don&apos;t regress on{' '}
        <a
          href="https://github.com/cedarjs/cedar/issues/317"
          className="text-blue-600 underline visited:text-purple-600 hover:text-blue-800"
          target="_blank"
          rel="noreferrer"
        >
          #317
        </a>
      </p>
      <img src={test} alt="Test" />
    </>
  )
}

export default DoublePage
