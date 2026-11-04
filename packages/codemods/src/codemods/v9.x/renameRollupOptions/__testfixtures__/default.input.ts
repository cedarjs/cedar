import { defineConfig } from 'vite'

import { cedar } from '@cedarjs/vite'

export default defineConfig(({ mode }) => ({
  plugins: [
    cedar({ mode }),
    {
      name: 'my-plugin',
      config(config) {
        config.build.rollupOptions = { external: ['fsevents'] }
      },
    },
  ],
  build: {
    rollupOptions: {
      output: { entryFileNames: '[name].js' },
    },
  },
  worker: {
    rollupOptions: { output: { format: 'es' } },
  },
  optimizeDeps: {
    rollupOptions: { external: ['fsevents'] },
  },
  ssr: {
    optimizeDeps: {
      rollupOptions: { external: ['fsevents'] },
    },
  },
  someOtherPlugin: {
    rollupOptions: 'left alone',
  },
}))
