import React, { type ReactNode } from 'react'

import { ThemeClassNames } from '@docusaurus/theme-common'
import type { Props } from '@theme/Footer/Layout'
import clsx from 'clsx'

export default function FooterLayout({
  style,
  links,
  logo,
  copyright,
}: Props): ReactNode {
  return (
    <footer
      className={clsx(ThemeClassNames.layout.footer.container, 'footer', {
        'footer--dark': style === 'dark',
      })}
    >
      <div className="container container-fluid">
        {links}
        <div className="footer__bottom text--center">
          <div className="margin-bottom--sm">
            <p>Built with Docusaurus. Hosted by Netlify.</p>
            <a href="https://www.netlify.com">
              <img
                src="https://www.netlify.com/assets/badges/netlify-badge-color-accent.svg"
                alt="Deploys by Netlify"
              />
            </a>
          </div>
          {logo && <div className="margin-bottom--sm">{logo}</div>}
          {copyright}
        </div>
      </div>
    </footer>
  )
}
