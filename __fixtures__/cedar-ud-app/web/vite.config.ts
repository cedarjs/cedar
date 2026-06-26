import dns from 'dns'
import { defineConfig } from 'vite'
import { cedar, cedarUniversalDeployPlugin } from '@cedarjs/vite'

dns.setDefaultResultOrder('verbatim')

export default defineConfig({
  plugins: [cedar(), cedarUniversalDeployPlugin()],
})
