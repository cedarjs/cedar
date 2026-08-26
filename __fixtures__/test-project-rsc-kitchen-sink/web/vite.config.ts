/// <reference types="vitest/config" />

import { defineConfig } from 'vite'

import { cedar } from '@cedarjs/vite'

export default defineConfig({
  plugins: [cedar()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
})
