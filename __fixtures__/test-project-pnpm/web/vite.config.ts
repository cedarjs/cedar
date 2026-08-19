import { defineConfig } from 'vite'

import { cedar } from '@cedarjs/vite'

export default defineConfig({
  plugins: [cedar()],
})
