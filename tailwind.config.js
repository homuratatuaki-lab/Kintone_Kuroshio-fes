/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./html/**/*.html', './js/**/*.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Meiryo', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

