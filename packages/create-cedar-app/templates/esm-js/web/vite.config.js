/// <reference types="vitest/config" />

import { defineConfig } from 'vite'

import { cedar } from '@cedarjs/vite'

export default defineConfig(({ mode }) => ({
  plugins: [cedar({ mode })],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    // Enables global test APIs like describe, it, expect
    globals: true,
  },
}))
