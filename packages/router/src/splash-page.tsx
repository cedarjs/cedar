import React, { useState, useEffect } from 'react'

type PathDefinition = string
interface SplashPageProps {
  hasGeneratedRoutes: boolean
  allStandardRoutes: Record<
    PathDefinition,
    { name: string | null; path: PathDefinition }
  >
}

export const SplashPage = ({
  hasGeneratedRoutes,
  allStandardRoutes: routesMap,
}: SplashPageProps) => {
  const routes = Object.values(routesMap)

  const version = useVersion()
  return (
    <>
      <main>
        <section>
          <style
            dangerouslySetInnerHTML={{
              __html: `
            :root {
              --foreground: rgb(26, 32, 44);
              --background: hsl(0, 0%, 100%);
              --background-2: rgb(253, 248, 246);
              --background-3: rgb(250, 234, 229);
              --highlight-1: rgb(191, 71, 34);
              --highlight-2: rgb(220, 94, 56);
              --highlight-3: rgba(220, 94, 56, 0.2);
              --space-0: 0.125rem;
              --space-1: 0.25rem;
              --space-2: 0.5rem;
              --space-3: 0.75rem;
              --space-4: 1rem;
              --space-5: 1.25rem;
              --space-6: 1.5rem;
              --space-7: 1.75rem;
              --space-8: 2rem;
              --space-9: 2.25rem;
              --space-10: 2.5rem;
              --space-11: 2.75rem;
              --space-12: 3rem;
              --space-14: 3.5rem;
              --space-16: 4rem;
              --space-18: 4.5rem;
              --space-20: 5rem;
            }

            @media (prefers-color-scheme: dark) {
              :root {
                --foreground: hsl(0, 0%, 100%);
                --background: hsl(250, 24%, 9%);
                --background-2: hsl(250, 21%, 11%);
                --background-3: rgb(53, 37, 32);
              }
            }

            html, body {
              margin: 0;
            }

            .container {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                "Helvetica Neue", Arial, "Noto Sans", sans-serif;
              color: var(--foreground);
              background-color: var(--background);
              display: flex;
              flex-direction: column;
              min-height: 100vh;
            }

            h1,
            h2,
            p {
              margin: 0;
            }

            h1,
            h2 {
              font-size: inherit;
              font-weight: inherit;
            }

            a {
              color: var(--highlight-1);
              text-decoration-thickness: 2px;
            }

            a:hover {
              color: var(--highlight-2);
            }

            /* Social */
            .social {
              display: flex;
              gap: var(--space-3);
              padding: var(--space-4) var(--space-5);
              justify-content: center;
            }

            .social-link {
              width: var(--space-6);
            }

            /* Content */
            .content-container {
              flex-grow: 1;
              display: flex;
              justify-content: center;
              align-items: center;
            }

            .content {
              padding: var(--space-5) var(--space-5) var(--space-8);
              position: relative;
            }

            /* Intro */
            .intro {
              text-align: center;
              margin-bottom: var(--space-18);
            }

            .intro-heading {
              font-size: var(--space-8);
              line-height: 1.25;
              font-weight: 700;
            }

            .intro-logo {
              max-width: 100%;
              height: auto;
              margin-bottom: var(--space-4);
            }

            .intro-instructions-container {
              margin-top: var(--space-8);
            }

            .intro-instructions {
              font-size: var(--space-5);
              font-weight: 400;
              line-height: var(--space-7);
              margin-bottom: var(--space-2);
            }

            code {
              font-family: Fira Code,Fira Mono,Menlo,Monoco,monospace;
              font-size: 0.8em;
              padding: var(--space-1) var(--space-2);
              border-radius: var(--space-1);
              color: var(--highlight-2);
              background-color: var(--highlight-3);
            }

            .pages {
              font-size: var(--space-5);
              line-height: var(--space-7);
            }

            .pages-title {
              margin-bottom: var(--space-1);
              font-weight: 400;
            }

            .pages-list {
              margin: var(--space-2) 0;
              padding: 0;
              list-style-type: none;
            }

            .pages-item {
              margin: var(--space-4) 0;
            }

            .callout {
              font-size: var(--space-4);
              line-height: var(--space-6);
              font-weight: 400;
              margin: var(--space-12) auto 0;
              max-width: 32rem;
              text-align: left;
              border-left: 3px solid;
              border-color: var(--highlight-2);
              color: var(--foreground);
              background-color: var(--background-2);
              padding: var(--space-4);
            }

            /* Resources */
            .resources {
              display: flex;
              flex-wrap: wrap;
              max-width: 56rem;
              margin: auto;
              gap: var(--space-4);
              justify-content: center;
            }

            .resource {
              flex-basis: 21rem;
              padding: var(--space-6);
              border-radius: var(--space-1);
              border: 2px solid;
              position: relative;
              color: var(--background);
              background-color: var(--highlight-1);
              border-color: transparent;
            }

            .resource:hover {
              background-color: var(--highlight-2);
              border-color: var(--highlight-2);
            }

            .icon {
              fill: white;
              width: var(--space-6);
            }

            .icon-container {
              display: flex;
              align-items: center;
              gap: var(--space-2);
              margin-bottom: var(--space-2);
            }

            @media (prefers-color-scheme: dark) {
              .resource {
                color: var(--foreground);
                background-color: var(--background-2);
                border-color: var(--highlight-1);
              }
              .resource:hover {
                background-color: var(--highlight-3);
              }
            }

            .resource-link {
              position: absolute;
              inset: 0;
            }

            .resource-title {
              font-size: var(--space-5);
              line-height: 1;
              font-weight: 700;
            }

            .resource-description {
              font-weight: 500;
              font-size: var(--space-4);
              line-height: var(--space-6);
            }

            .footer {
              position: relative;
              text-align: center;
              font-weight: 400;
              padding: var(--space-5);
              font-size: var(--space-4);
              line-height: var(--space-6);
            }
          `,
            }}
          />
          <section className="container">
            <section className="content-container">
              <div className="content">
                <div className="intro">
                  <img
                    src="https://avatars.githubusercontent.com/u/211931789?s=200&v=4"
                    alt="CedarJS Logo"
                    className="intro-logo"
                  />
                  <h1 className="intro-heading">Welcome to CedarJS</h1>
                  {!hasGeneratedRoutes ? (
                    <div
                      className="intro-instructions-container"
                      data-cy="e2e-test-splashpage"
                    >
                      <p className="intro-instructions">
                        You’re seeing this because you don’t have any pages yet.
                      </p>
                      <p className="intro-instructions">
                        Type <code>yarn cedar generate page my-page</code> in
                        your terminal to get started!
                      </p>
                    </div>
                  ) : (
                    <div
                      className="intro-instructions-container"
                      data-cy="e2e-test-splashpage"
                    >
                      <div className="pages">
                        <p className="pages-title">List of Pages by path:</p>
                        <ul className="pages-list">
                          {routes.map((route, index) => {
                            return (
                              <li key={index} className="pages-item">
                                <code>
                                  {`${route.name} -> `}
                                  <a
                                    href={route.path}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {route.path}
                                  </a>
                                </code>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                      <div className="callout">
                        You’re seeing this because you don’t have a page at the{' '}
                        <code>/</code> path.
                        <br />
                        Type <code>yarn cedar generate page home /</code> in
                        your terminal to create one.
                      </div>
                    </div>
                  )}
                </div>
                <div className="resources">
                  <div className="resource">
                    <a
                      className="resource-link"
                      href="https://cedarjs.com/docs/tutorial"
                      target="_blank"
                      rel="noreferrer"
                    ></a>
                    <div className="icon-container">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        className="icon"
                      >
                        <path d="M0 0h24v24H0V0z" fill="none"></path>
                        <path d="M4 5h16v11H4z" opacity=".3"></path>
                        <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2H0c0 1.1.9 2 2 2h20c1.1 0 2-.9 2-2h-4zM4 5h16v11H4V5zm8 14c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"></path>
                      </svg>
                      <h2 className="resource-title">Tutorial</h2>
                    </div>

                    <p className="resource-description">
                      Start here to learn how to build full-stack apps with
                      Cedar.
                    </p>
                  </div>

                  <div className="resource">
                    <a
                      className="resource-link"
                      href="https://cedarjs.com/docs"
                      target="_blank"
                      rel="noreferrer"
                    ></a>
                    <div className="icon-container">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        className="icon"
                      >
                        <path d="M0 0h24v24H0V0z" fill="none"></path>
                        <path
                          d="M13 13l-3-2.25L7 13V4H6v16h12V4h-5z"
                          opacity=".3"
                        ></path>
                        <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM9 4h2v5l-1-.75L9 9V4zm9 16H6V4h1v9l3-2.25L13 13V4h5v16z"></path>
                      </svg>
                      <h2 className="resource-title">Docs and How To&apos;s</h2>
                    </div>

                    <p className="resource-description">
                      Find in-depth information about CedarJS features and API.
                    </p>
                  </div>

                  <div className="resource">
                    <a
                      className="resource-link"
                      href="https://cedarjs.com/discord"
                      target="_blank"
                      rel="noreferrer"
                    ></a>
                    <div className="icon-container">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        className="icon"
                      >
                        <path d="M0 0h24v24H0V0z" fill="none"></path>
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm0 15.17L18.83 16H4V4h16v13.17z"></path>
                        <path d="M4 4v12h14.83L20 17.17V4z" opacity=".3"></path>
                      </svg>
                      <h2 className="resource-title">Join the Community</h2>
                    </div>

                    <p className="resource-description">
                      Get help, share tips, and collaborate together on Cedar.
                    </p>
                  </div>

                  <div className="resource">
                    <a
                      className="resource-link"
                      href="https://cedarjs.com/docs/contributing"
                      target="_blank"
                      rel="noreferrer"
                    ></a>
                    <div className="icon-container">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        className="icon"
                      >
                        <g>
                          <rect fill="none" height="24" width="24"></rect>
                        </g>
                        <g>
                          <path d="M21,5c-1.11-0.35-2.33-0.5-3.5-0.5c-1.95,0-4.05,0.4-5.5,1.5c-1.45-1.1-3.55-1.5-5.5-1.5S2.45,4.9,1,6v14.65 c0,0.25,0.25,0.5,0.5,0.5c0.1,0,0.15-0.05,0.25-0.05C3.1,20.45,5.05,20,6.5,20c1.95,0,4.05,0.4,5.5,1.5c1.35-0.85,3.8-1.5,5.5-1.5 c1.65,0,3.35,0.3,4.75,1.05c0.1,0.05,0.15,0.05,0.25,0.05c0.25,0,0.5-0.25,0.5-0.5V6C22.4,5.55,21.75,5.25,21,5z M3,18.5V7 c1.1-0.35,2.3-0.5,3.5-0.5c1.34,0,3.13,0.41,4.5,0.99v11.5C9.63,18.41,7.84,18,6.5,18C5.3,18,4.1,18.15,3,18.5z M21,18.5 c-1.1-0.35-2.3-0.5-3.5-0.5c-1.34,0-3.13,0.41-4.5,0.99V7.49c1.37-0.59,3.16-0.99,4.5-0.99c1.2,0,2.4,0.15,3.5,0.5V18.5z"></path>
                          <path
                            d="M11,7.49C9.63,6.91,7.84,6.5,6.5,6.5C5.3,6.5,4.1,6.65,3,7v11.5C4.1,18.15,5.3,18,6.5,18 c1.34,0,3.13,0.41,4.5,0.99V7.49z"
                            opacity=".3"
                          ></path>
                        </g>
                        <g>
                          <path d="M17.5,10.5c0.88,0,1.73,0.09,2.5,0.26V9.24C19.21,9.09,18.36,9,17.5,9c-1.28,0-2.46,0.16-3.5,0.47v1.57 C14.99,10.69,16.18,10.5,17.5,10.5z"></path>
                          <path d="M17.5,13.16c0.88,0,1.73,0.09,2.5,0.26V11.9c-0.79-0.15-1.64-0.24-2.5-0.24c-1.28,0-2.46,0.16-3.5,0.47v1.57 C14.99,13.36,16.18,13.16,17.5,13.16z"></path>
                          <path d="M17.5,15.83c0.88,0,1.73,0.09,2.5,0.26v-1.52c-0.79-0.15-1.64-0.24-2.5-0.24c-1.28,0-2.46,0.16-3.5,0.47v1.57 C14.99,16.02,16.18,15.83,17.5,15.83z"></path>
                        </g>
                      </svg>
                      <h2 className="resource-title">Become a Contributor</h2>
                    </div>
                    <p className="resource-description">
                      Love CedarJS and want to get involved? Contribute today!
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="footer">
              <div className="social">
                <a
                  className="social-link"
                  href="https://github.com/cedarjs/cedar"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Go to the CedarJS GitHub repo"
                >
                  <svg viewBox="0 0 32 32" focusable="false">
                    <path
                      fill="currentColor"
                      d="M15.9995 -8.73473e-07C12.198 -0.00275596 8.5196 1.34817 5.62346 3.81077C2.72731 6.27336 0.802616 9.6867 0.194194 13.4393C-0.414229 17.1919 0.333374 21.0385 2.30307 24.29C4.27276 27.5415 7.33584 29.9855 10.9435 31.184C11.7435 31.344 12.0315 30.832 12.0315 30.416L12.0155 27.696C7.56755 28.656 6.62355 25.552 6.62355 25.552C5.88755 23.696 4.84755 23.2 4.84755 23.2C3.40755 22.208 4.95955 22.24 4.95955 22.24C6.55955 22.352 7.40755 23.888 7.40755 23.888C8.84755 26.32 11.1515 25.616 12.0635 25.216C12.2235 24.176 12.6235 23.472 13.0715 23.072C9.51955 22.672 5.79155 21.296 5.79155 15.168C5.79155 13.408 6.41555 11.984 7.43955 10.864C6.95565 9.4866 7.01283 7.97684 7.59955 6.64C7.59955 6.64 8.94355 6.208 11.9995 8.272C14.6192 7.56384 17.3799 7.56384 19.9995 8.272C23.0555 6.192 24.3995 6.64 24.3995 6.64C25.2795 8.832 24.7195 10.48 24.5595 10.864C25.5835 11.984 26.2075 13.424 26.2075 15.168C26.2075 21.312 22.4635 22.656 18.8955 23.056C19.4715 23.552 19.9835 24.528 19.9835 26.016L19.9675 30.416C19.9675 30.832 20.2555 31.344 21.0715 31.184C24.6806 29.985 27.7445 27.5398 29.7141 24.2866C31.6837 21.0334 32.4302 17.185 31.8197 13.4314C31.2092 9.67772 29.2816 6.26427 26.3825 3.80296C23.4835 1.34165 19.8025 -0.00657403 15.9995 -8.73473e-07Z"
                    ></path>
                  </svg>
                </a>
                <a
                  className="social-link"
                  href="https://x.com/cedarjs"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Go to the CedarJS Twitter/X profile"
                >
                  <svg viewBox="0 0 34 34" focusable="false">
                    <path
                      fill="currentColor"
                      d="M10.693 31.025C23.528 31.025 30.532 20.4 30.532 11.186V10.285C31.892 9.282 33.065 8.075 34 6.664C32.725 7.225 31.382 7.599 29.988 7.769C31.4415 6.89552 32.5288 5.52436 33.048 3.91C31.688 4.726 30.192 5.287 28.628 5.61C27.5817 4.47537 26.1884 3.72011 24.6667 3.46265C23.1449 3.20519 21.5807 3.46011 20.2194 4.18742C18.8582 4.91474 17.7768 6.0733 17.1449 7.48142C16.513 8.88954 16.3664 10.4676 16.728 11.968C13.9549 11.8247 11.243 11.0998 8.76823 9.84043C6.29346 8.58108 4.11117 6.8154 2.363 4.658C1.46192 6.19488 1.18356 8.01846 1.58508 9.75418C1.98661 11.4899 3.03753 13.006 4.522 13.991C3.417 13.94 2.329 13.651 1.36 13.09V13.175C1.35653 14.7901 1.91405 16.3562 2.93729 17.6058C3.96053 18.8554 5.38596 19.7109 6.97 20.026C5.93906 20.3076 4.85718 20.3483 3.808 20.145C4.25151 21.5313 5.11789 22.744 6.2856 23.6129C7.4533 24.4818 8.86372 24.9634 10.319 24.99C8.87328 26.1262 7.21777 26.9662 5.44716 27.4621C3.67654 27.958 1.82554 28.1 0 27.88C3.19039 29.927 6.90238 31.0129 10.693 31.008"
                    ></path>
                  </svg>
                </a>
                <a
                  className="social-link"
                  href="https://cedarjs.com/discord"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Go to the CedarJS Discord server"
                >
                  <svg viewBox="0 0 36 36" focusable="false">
                    <path
                      fill="currentColor"
                      d="M29.9699 7.7544C27.1043 5.44752 22.5705 5.05656 22.3761 5.04288C22.2284 5.03072 22.0806 5.0648 21.9531 5.1404C21.8257 5.216 21.7249 5.32937 21.6647 5.4648C21.5783 5.65936 21.5049 5.85949 21.4451 6.06384C23.3409 6.38424 25.6694 7.02864 27.7761 8.33616C27.8565 8.38604 27.9262 8.45126 27.9814 8.52809C28.0366 8.60493 28.0761 8.69187 28.0976 8.78397C28.1192 8.87607 28.1224 8.97151 28.1071 9.06485C28.0917 9.15819 28.0582 9.24759 28.0083 9.32796C27.9584 9.40833 27.8932 9.47809 27.8164 9.53325C27.7395 9.58842 27.6526 9.62791 27.5605 9.64947C27.4684 9.67103 27.373 9.67424 27.2796 9.65892C27.1863 9.6436 27.0969 9.61004 27.0165 9.56016C23.3949 7.3116 18.8719 7.2 17.9999 7.2C17.1287 7.2 12.6028 7.31232 8.98338 9.55944C8.90301 9.60932 8.81361 9.64288 8.72027 9.6582C8.62693 9.67352 8.53149 9.67031 8.43939 9.64875C8.25339 9.6052 8.09231 9.48955 7.99158 9.32724C7.89085 9.16493 7.85873 8.96925 7.90227 8.78325C7.94582 8.59725 8.06147 8.43617 8.22378 8.33544C10.3305 7.03152 12.659 6.38424 14.5547 6.06672C14.4453 5.7096 14.3459 5.48424 14.3387 5.4648C14.2788 5.32841 14.1776 5.2143 14.0493 5.13859C13.921 5.06288 13.7721 5.0294 13.6238 5.04288C13.4294 5.05728 8.89554 5.44752 5.99034 7.78536C4.47474 9.18792 1.43994 17.3894 1.43994 24.48C1.43994 24.6067 1.47378 24.7277 1.5357 24.8371C3.62802 28.5163 9.3405 29.4775 10.6423 29.52H10.6646C10.7782 29.5203 10.8903 29.4937 10.9916 29.4424C11.093 29.3911 11.1808 29.3165 11.2478 29.2248L12.5632 27.4133C9.01146 26.4967 7.19706 24.9386 7.09338 24.8458C6.95017 24.7194 6.86303 24.5412 6.85115 24.3506C6.83927 24.1599 6.90361 23.9723 7.03002 23.8291C7.15643 23.6859 7.33456 23.5988 7.52522 23.5869C7.71588 23.575 7.90345 23.6394 8.04666 23.7658C8.08842 23.8054 11.4299 26.64 17.9999 26.64C24.5807 26.64 27.9223 23.7938 27.9561 23.7658C28.0998 23.6403 28.2874 23.5769 28.4777 23.5896C28.668 23.6023 28.8456 23.69 28.9713 23.8334C29.0335 23.9042 29.0812 23.9864 29.1117 24.0756C29.1421 24.1647 29.1546 24.259 29.1486 24.353C29.1426 24.447 29.1181 24.5389 29.0766 24.6235C29.035 24.708 28.9772 24.7836 28.9065 24.8458C28.8028 24.9386 26.9884 26.4967 23.4367 27.4133L24.7528 29.2248C24.8198 29.3164 24.9074 29.3909 25.0087 29.4422C25.1099 29.4935 25.2218 29.5202 25.3353 29.52H25.3569C26.6601 29.4775 32.3719 28.5156 34.4649 24.8371C34.5261 24.7277 34.5599 24.6067 34.5599 24.48C34.5599 17.3894 31.5251 9.18864 29.9699 7.7544V7.7544ZM13.3199 21.6C11.9275 21.6 10.7999 20.3112 10.7999 18.72C10.7999 17.1288 11.9275 15.84 13.3199 15.84C14.7124 15.84 15.8399 17.1288 15.8399 18.72C15.8399 20.3112 14.7124 21.6 13.3199 21.6ZM22.6799 21.6C21.2875 21.6 20.1599 20.3112 20.1599 18.72C20.1599 17.1288 21.2875 15.84 22.6799 15.84C24.0724 15.84 25.1999 17.1288 25.1999 18.72C25.1999 20.3112 24.0724 21.6 22.6799 21.6Z"
                    ></path>
                  </svg>
                </a>
              </div>
              {version && (
                <>
                  Cedar version{' '}
                  <a
                    href="https://github.com/cedarjs/cedar/releases"
                    target="_blank"
                    rel="noreferrer"
                  >
                    v{version}
                  </a>
                </>
              )}
            </section>
          </section>
        </section>
      </main>
    </>
  )
}

const useVersion = () => {
  const [version, setVersion] = useState(null)
  useEffect(() => {
    async function fetchVersion() {
      try {
        const response = await globalThis.fetch(
          globalThis.RWJS_API_GRAPHQL_URL,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              query: 'query RedwoodVersion { redwood { version } }',
            }),
          },
        )

        const versionData = await response.json()
        setVersion(versionData?.data?.redwood?.version || null)
      } catch (err) {
        console.error('Unable to get CedarJS version: ', err)
      }
    }

    if (!globalThis.fetch) {
      return
    }

    fetchVersion()
  }, [])
  return version
}
