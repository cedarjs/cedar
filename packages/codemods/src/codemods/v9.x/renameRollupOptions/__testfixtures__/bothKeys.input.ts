import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: { external: ['ignored-by-vite'] },
    rolldownOptions: { external: ['used-by-vite'] },
  },
})
