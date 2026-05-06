import dns from 'dns'
import { defineConfig } from 'vite'
import { cedar } from '@cedarjs/vite'

dns.setDefaultResultOrder('verbatim')

export default defineConfig({
  plugins: [cedar()],
})
