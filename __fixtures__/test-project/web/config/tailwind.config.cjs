const { join } = require('node:path')

/** @type {import('tailwindcss').Config} */
export default {
  content: [join(__dirname, '../src/**/*.{js,jsx,ts,tsx}')],
  theme: {
    extend: {},
  },
  plugins: [],
}
