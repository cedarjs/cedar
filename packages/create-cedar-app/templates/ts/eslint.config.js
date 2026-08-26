import cedarConfig from '@cedarjs/eslint-config'

export default [
  ...(await cedarConfig()),
  {
    files: ['web/src/**/*Cell.tsx'],
    rules: {
      '@cedarjs/cell-type-annotations': 'error',
    },
  },
]
