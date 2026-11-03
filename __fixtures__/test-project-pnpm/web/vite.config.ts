/// <reference types="vitest/config" />

import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

import { cedar } from '@cedarjs/vite'

export default defineConfig(({ mode }) => ({
  plugins: [
    tailwindcss(),
    cedar({ mode }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Enables global test APIs like describe, it, expect
    globals: true,
  },
}))
