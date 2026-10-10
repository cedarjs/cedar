import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

import { cedar } from '@cedarjs/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    cedar(),
  ],
})
