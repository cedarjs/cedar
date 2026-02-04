# ESLint Config

<!-- toc -->

- [ESLint Config](#eslint-config)
  - [Purpose and Vision](#purpose-and-vision)
  - [Roadmap](#roadmap)
  - [Contributing](#contributing)
  - [Usage (Flat Config - Recommended)](#usage-flat-config---recommended)
  - [Overriding Default Configuration (Flat Config)](#overriding-default-configuration-flat-config)
  - [Migration Guide (Optional)](#migration-guide-optional)
  - [Legacy Configuration (Still Supported)](#legacy-configuration-still-supported)

## Purpose and Vision

This package contains a shareable set of ESLint rules and configuration that can be re-used on all CedarJS projects. The framework [`eslint-config`](https://github.com/cedarjs/cedar/tree/main/packages/eslint-config) package is used both for framework configuration and CedarJS app (created with the [create-cedar-app](https://github.com/cedarjs/cedar/tree/main/packages/create-cedar-app) package) configuration.

Our configuration uses recommended rule presets, including those from [ESLint](https://eslint.org/docs/rules/), [React](https://www.npmjs.com/package/eslint-plugin-react#list-of-supported-rules), the [Rules of Hooks](https://reactjs.org/docs/hooks-rules.html), and [Jest](https://github.com/testing-library/eslint-plugin-jest-dom#supported-rules). We also override the presets with some stylistic preferences. Some of them are:

- [No semicolons](https://eslint.org/docs/rules/semi) at the end of statements
- [Trailing commas](https://eslint.org/docs/rules/comma-dangle) in object and array literals
- [Use single quotes](https://eslint.org/docs/rules/quotes) on strings wherever possible
- [Use parentheses](https://eslint.org/docs/rules/arrow-parens) around arrow function parameters
- [Sort import declarations](https://eslint.org/docs/rules/sort-imports) by name
- [Wrap block statements](https://eslint.org/docs/rules/curly) in curly braces

## Roadmap

- Lint for case-sensitive imports (issue [#2806](https://github.com/cedarjs/cedar/issues/2806))

## Contributing

This package doesn't depend on other Cedar Framework packages. To contribute, you should be familiar with the ESLint package. Keep in mind that any rules added should not conflict with code formatting tools (e.g. [Prettier](https://prettier.io/docs/en/integrating-with-linters.html)).

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

## Migration Guide (Optional)

**The legacy `.eslintrc.js` format still works** - you don't have to migrate. However, if you want to use the new flat config format, follow these steps:

1. **Create a new flat config file** in your project root:

   ```javascript
   // eslint.config.mjs (for CommonJS projects)
   // or eslint.config.js (for ESM projects with "type": "module")
   import cedarConfig from '@cedarjs/eslint-config'

   export default await cedarConfig()
   ```

2. **Remove old config**:
   - Delete `.eslintrc.js` if it exists
   - Remove `eslintConfig` field from `package.json` if it exists

3. **Update your package.json scripts** (if needed):

   ```json
   {
     "scripts": {
       "lint": "eslint .",
       "lint:fix": "eslint . --fix"
     }
   }
   ```

4. **Migrate custom rules**: If you had custom rules in your old config, add them to your new flat config:
   ```javascript
   export default [
     ...(await cedarConfig()),
     {
       rules: {
         // Your custom rules here
       },
     },
   ]
   ```

That's it! Your linting should work the same as before.

## Legacy Configuration (Still Supported)

The legacy `.eslintrc.js` format is still fully supported. You can continue using it:

```javascript
// cedar-app/.eslintrc.js
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

**Note:** While both formats are supported, we recommend migrating to flat config when convenient. See the [Migration Guide](#migration-guide-optional) above.
