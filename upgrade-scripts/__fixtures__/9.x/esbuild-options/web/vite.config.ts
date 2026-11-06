import { defineConfig } from 'vite'

import { cedar } from '@cedarjs/vite'

const sharedOptions = {}

export default defineConfig(({ mode }) => ({
  plugins: [cedar({ mode })],
  esbuild: {
    jsxFactory: 'h',
    target: 'es2020',
  },
  optimizeDeps: {
    esbuildOptions: {
      ...sharedOptions,
      define: { global: 'globalThis' },
      plugins: [],
    },
  },
}))
