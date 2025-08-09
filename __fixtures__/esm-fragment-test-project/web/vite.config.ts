/// <reference types="vitest/config" />

import dns from 'node:dns'

import { defineConfig } from 'vite'

import { cedar } from '@cedarjs/vite'

// So that Vite will load on localhost instead of `127.0.0.1`.
// See: https://vitejs.dev/config/server-options.html#server-host.
dns.setDefaultResultOrder('verbatim')

export default defineConfig(({ mode }) => ({
  plugins: [cedar({ mode })],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Enables global test APIs like describe, it, expect
    globals: true,
  },
}))
