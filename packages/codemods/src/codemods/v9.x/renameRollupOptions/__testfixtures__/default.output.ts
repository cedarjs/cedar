import { defineConfig } from 'vite'

import { cedar } from '@cedarjs/vite'

export default defineConfig(({ mode }) => ({
  plugins: [
    cedar({ mode }),
    {
      name: 'my-plugin',
      config(config) {
        config.build.rolldownOptions = { external: ['fsevents'] }
      },
    },
  ],
  build: {
    rolldownOptions: {
      output: { entryFileNames: '[name].js' },
    },
  },
  worker: {
    rolldownOptions: { output: { format: 'es' } },
  },
  optimizeDeps: {
    rolldownOptions: { external: ['fsevents'] },
  },
  ssr: {
    optimizeDeps: {
      rolldownOptions: { external: ['fsevents'] },
    },
  },
  someOtherPlugin: {
    rollupOptions: 'left alone',
  },
}))
