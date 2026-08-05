import { defineConfig } from 'vite'
import { cedar, cedarUniversalDeployPlugin } from '@cedarjs/vite'

export default defineConfig({
  plugins: [cedar(), cedarUniversalDeployPlugin()],
})
