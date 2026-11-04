import { defineConfig } from 'vite'

import { cedar as cedarPlugin } from '@cedarjs/vite'

export default defineConfig(({ mode }) => ({
  plugins: [
    cedarPlugin({
      mode,
      babel: { plugins: ['babel-plugin-macros'] },
    }),
  ],
}))
