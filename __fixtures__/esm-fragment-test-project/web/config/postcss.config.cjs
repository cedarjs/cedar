const path = require('path')

module.exports = {
  plugins: [
    require('tailwindcss/nesting'),
    require('tailwindcss')(path.resolve(__dirname, 'tailwind.config.cjs')),
    require('autoprefixer'),
  ],
}
