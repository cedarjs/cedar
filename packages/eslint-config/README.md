# ESLint Config

<!-- toc -->

- [ESLint Config](#eslint-config)
  - [Purpose and Vision](#purpose-and-vision)
  - [Package Leads](#package-leads)
  - [Roadmap](#roadmap)
  - [Contributing](#contributing)
  - [Usage (Flat Config - Recommended)](#usage-flat-config---recommended)
  - [Overriding Default Configuration (Flat Config)](#overriding-default-configuration-flat-config)
  - [Legacy Configuration (Deprecated)](#legacy-configuration-deprecated)

## Purpose and Vision

This package contains a shareable set of ESLint rules and configuration that can be re-used on all CedarJS projects. The framework [`eslint-config`](https://github.com/cedarjs/cedar/tree/main/packages/eslint-config) package is used both for framework configuration and CedarJS app (created with the [create-cedar-app](https://github.com/cedarjs/cedar/tree/main/packages/create-cedar-app) package) configuration.

Our configuration uses recommended rule presets, including those from [ESLint](https://eslint.org/docs/rules/), [React](https://www.npmjs.com/package/eslint-plugin-react#list-of-supported-rules), the [Rules of Hooks](https://reactjs.org/docs/hooks-rules.html), and [Jest](https://github.com/testing-library/eslint-plugin-jest-dom#supported-rules). We also override the presets with some stylistic preferences. Some of them are:

- [No semicolons](https://eslint.org/docs/rules/semi) at the end of statements
- [Trailing commas](https://eslint.org/docs/rules/comma-dangle) in object and array literals
- [Use single quotes](https://eslint.org/docs/rules/quotes) on strings wherever possible
- [Use parentheses](https://eslint.org/docs/rules/arrow-parens) around arrow function parameters
- [Sort import declarations](https://eslint.org/docs/rules/sort-imports) by name
- [Wrap block statements](https://eslint.org/docs/rules/curly) in curly braces

## Package Leads

Peter Pistorius (@peterp), David Price (@thedavidprice), Dominic Saadi (@jtoar), Daniel Choudhury (@dac09)

## Roadmap

- Lint for case-sensitive imports (issue [#2806](https://github.com/redwoodjs/redwood/issues/2806))

## Contributing

This package doesn't depend on other Redwood Framework packages. To contribute, you should be familiar with the ESLint package. Keep in mind that any rules added should not conflict with code formatting tools (e.g. [Prettier](https://prettier.io/docs/en/integrating-with-linters.html)).

## Usage (Flat Config - Recommended)

CedarJS uses ESLint's flat config format by default. Create an `eslint.config.js` file in your project root:

```javascript
// cedar-app/eslint.config.js
import cedarConfig from '@cedarjs/eslint-config'

export default await cedarConfig()
```

Note: The config is async because it needs to load your Cedar project configuration.

## Overriding Default Configuration (Flat Config)

To override rules in your CedarJS app, add additional config objects after the Cedar config:

```javascript
// cedar-app/eslint.config.js
import cedarConfig from '@cedarjs/eslint-config'

export default [
  ...(await cedarConfig()),
  {
    rules: {
      'jsx-a11y/no-onchange': 'off',
      'no-console': 'warn',
    },
  },
]
```

You can also add file-specific overrides:

```javascript
// cedar-app/eslint.config.js
import cedarConfig from '@cedarjs/eslint-config'

export default [
  ...(await cedarConfig()),
  {
    files: ['web/src/**/*.tsx'],
    rules: {
      'react/prop-types': 'off',
    },
  },
]
```

To ignore specific files or directories:

```javascript
// cedar-app/eslint.config.js
import cedarConfig from '@cedarjs/eslint-config'

export default [
  {
    ignores: ['scripts/**', 'generated/**'],
  },
  ...(await cedarConfig()),
]
```

## Legacy Configuration (Deprecated)

> **Note:** The legacy `.eslintrc.js` format is deprecated. Please migrate to flat config.

For projects still using the legacy format, you can use the old CommonJS export:

```javascript
// cedar-app/.eslintrc.js (DEPRECATED)
module.exports = {
  extends: ['@cedarjs/eslint-config'],
  root: true,
  rules: {
    'jsx-a11y/no-onchange': 'off',
  },
}
```

Or in `package.json`:

```json
{
  "eslintConfig": {
    "extends": "@cedarjs/eslint-config",
    "root": true
  }
}
```

**Migration Guide:** See [ESLint Flat Config Migration](../../ESLINT_FLAT_CONFIG_MIGRATION.md) for migration instructions.
