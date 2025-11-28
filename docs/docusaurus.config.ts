import type * as PresetClassic from '@docusaurus/preset-classic'
import type { Config } from '@docusaurus/types'
import type { PluginOptions as SearchLocalPluginOptions } from '@easyops-cn/docusaurus-search-local'
import type { PluginOptions as LlmsTxtPluginOptions } from '@signalwire/docusaurus-plugin-llms-txt/public'

import autoImportTabs from './src/remark/auto-import-tabs.mjs'
import fileExtSwitcher from './src/remark/file-ext-switcher.mjs'

const config: Config = {
  customFields: {
    defaultDocsLandingPage: 'introduction', // redirects here when hitting /docs/
    defaultSectionLandingPages: {
      // map of what is considered the first article in each section
      // section: id
      tutorial: 'forward',
    },
  },
  title: 'CedarJS',
  tagline: 'The React + GraphQL Web App Framework',
  url: 'https://cedarjs.com',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  favicon: '/img/favicon.ico',
  organizationName: 'cedarjs', // Usually your GitHub org/user name.
  // ?
  projectName: 'cedar', // Usually your repo name.,
  themeConfig: {
    image: 'img/og-image.png',
    navbar: {
      title: 'CedarJS',
      logo: {
        alt: 'CedarJS logo',
        src: 'https://avatars.githubusercontent.com/u/211931789?s=200&v=4',
        href: 'https://cedarjs.com',
        target: '_self',
      },
      items: [
        {
          type: 'docsVersionDropdown',
          position: 'left',
        },
        {
          href: 'https://github.com/cedarjs/cedar',
          position: 'right',
          className: 'github-logo',
          'aria-label': 'GitHub repository',
        },
      ],
    },
    prism: {
      additionalLanguages: ['toml', 'diff', 'bash', 'json'],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Tutorial',
              to: 'docs/tutorial/foreword',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Discord',
              href: 'https://cedarjs.com/discord',
            },
            // {
            //   label: 'Discourse',
            //   href: 'https://community.redwoodjs.com/',
            // },
            {
              label: 'Twitter/X',
              href: 'https://x.com/cedarjs',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'cedarjs.com',
              to: 'https://cedarjs.com/',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/cedarjs/cedar',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} CedarJS.`,
    },
  } satisfies PresetClassic.ThemeConfig,
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: false,
      } satisfies SearchLocalPluginOptions,
    ],
    '@signalwire/docusaurus-theme-llms-txt',
  ],
  plugins: [
    [
      '@signalwire/docusaurus-plugin-llms-txt',
      {
        llmsTxt: {
          siteDescription:
            'CedarJS is the full-stack web framework designed to help you ' +
            'grow from side project to startup. CedarJS features an end-to-' +
            'end development workflow that weaves together the best parts of ' +
            'React, GraphQL, Prisma, TypeScript, Vitest, and Storybook.',
          enableLlmsFullTxt: true,
          excludeRoutes: ['/search'],
          sections: [
            {
              id: 'introduction',
              name: 'Introduction',
              position: 1,
              routes: [{ route: '/docs/introduction' }],
            },
            {
              id: 'quick-start',
              name: 'Quick Start',
              position: 2,
              routes: [{ route: '/docs/quick-start' }],
            },
            {
              id: 'tutorial',
              name: 'Tutorial',
              position: 3,
              routes: [{ route: '/docs/tutorial/**' }],
            },
            {
              id: 'reference',
              name: 'Reference',
              position: 4,
              routes: [
                { route: '/docs/reference' },
                { route: '/docs/accessibility' },
                { route: '/docs/app-configuration-redwood-toml' },
                { route: '/docs/assets-and-files' },
                { route: '/docs/authentication' },
                { route: '/docs/auth/**' },
                { route: '/docs/background-jobs' },
                { route: '/docs/builds' },
                { route: '/docs/cells' },
                { route: '/docs/cli-commands' },
                { route: '/docs/connection-pooling' },
                { route: '/docs/contributing' },
                { route: '/docs/contributing-walkthrough' },
                { route: '/docs/cors' },
                { route: '/docs/create-cedar-app' },
                { route: '/docs/data-migrations' },
                { route: '/docs/deployment/index' },
                { route: '/docs/deploy/**' },
                { route: '/docs/database-seeds' },
                { route: '/docs/directives' },
                { route: '/docs/docker' },
                { route: '/docs/environment-variables' },
                { route: '/docs/forms' },
                { route: '/docs/graphql/**' },
                { route: '/docs/intro-to-servers' },
                { route: '/docs/local-postgres-setup' },
                { route: '/docs/logger' },
                { route: '/docs/mailer' },
                { route: '/docs/monitoring/**' },
                { route: '/docs/prerender' },
                { route: '/docs/project-configuration-dev-test-build' },
                { route: '/docs/redwoodrecord' },
                { route: '/docs/realtime' },
                { route: '/docs/router' },
                { route: '/docs/schema-relations' },
                { route: '/docs/security' },
                { route: '/docs/seo-head' },
                { route: '/docs/server-file' },
                { route: '/docs/serverless-functions' },
                { route: '/docs/services' },
                { route: '/docs/storybook' },
                { route: '/docs/studio' },
                { route: '/docs/testing' },
                { route: '/docs/toast-notifications' },
                { route: '/docs/typescript/**' },
                { route: '/docs/webhooks' },
                { route: '/docs/uploads' },
                { route: '/docs/vite-configuration' },
              ],
            },
            {
              id: 'how-to',
              name: 'How To',
              position: 5,
              routes: [{ route: '/docs/how-to/**' }],
            },
            {
              id: 'upgrade-guides',
              name: 'Upgrade Guides',
              position: 6,
              routes: [{ route: '/docs/upgrade-guides/**' }],
            },
          ],
        },
        ui: {
          copyPageContent: true,
        },
        logLevel: 1,
      } satisfies LlmsTxtPluginOptions,
    ],
  ],
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          // ? — blob? tree?
          editUrl: 'https://github.com/cedarjs/cedar/blob/main/docs', // base path for repo edit pages
          editCurrentVersion: true,
          remarkPlugins: [autoImportTabs, fileExtSwitcher],
          versions: {
            current: {
              label: 'Canary',
              path: 'canary',
              banner: 'unreleased',
            },
          },
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      } satisfies PresetClassic.Options,
    ],
  ],
  // ?
  // scripts: [
  //   {
  //     src: 'https://plausible.io/js/script.outbound-links.tagged-events.js',
  //     defer: true,
  //     'data-domain': 'docs.redwoodjs.com',
  //   },
  // ],
  stylesheets: [
    'https://fonts.googleapis.com/css?family=Open+Sans:400,600,700&display=swap',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;900&display=swap',
  ],
  future: {
    v4: true, // opt-in for Docusaurus v4 planned changes
    experimental_faster: true, // turns Docusaurus Faster on globally
  },
}

export default config
