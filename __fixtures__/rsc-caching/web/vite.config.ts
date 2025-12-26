import dns from 'dns'

import { defineConfig } from 'vite'

import { cedar } from '@cedarjs/vite'

// So that Vite will load on localhost instead of `127.0.0.1`.
// See: https://vitejs.dev/config/server-options.html#server-host.
dns.setDefaultResultOrder('verbatim')

export default defineConfig({
  plugins: [cedar()],
})
