import { defineConfig } from 'vite'

import cedar from '@cedarjs/vite'

const cedarOptions = { mode: 'production' }
const extraOptions = {}

const fromVariable = cedar(cedarOptions)
const fromSpread = cedar({ ...extraOptions })

export default defineConfig({
  plugins: [fromVariable, fromSpread],
})
