import React, { type ReactNode } from 'react'

import type { WrapperProps } from '@docusaurus/types'
import type FooterType from '@theme/Footer'
import Footer from '@theme-original/Footer'

type Props = WrapperProps<typeof FooterType>

export default function FooterWrapper(props: Props): ReactNode {
  return (
    <>
      <div>
        <p>Built with Docusaurus. Hosted by Netlify.</p>
        <a href="https://www.netlify.com">
          <img
            src="https://www.netlify.com/assets/badges/netlify-badge-light.svg"
            alt="Deploys by Netlify"
          />
        </a>
      </div>
      <Footer {...props} />
    </>
  )
}
