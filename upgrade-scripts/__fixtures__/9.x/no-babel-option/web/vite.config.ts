import { defineConfig } from 'vite'

import { cedar } from '@cedarjs/vite'

// Only `babel` options passed to cedar() are reported
function otherPlugin(_options: { babel: boolean }) {
  return { name: 'other' }
}

export default defineConfig(({ mode }) => ({
  plugins: [cedar({ mode }), otherPlugin({ babel: true })],
}))
