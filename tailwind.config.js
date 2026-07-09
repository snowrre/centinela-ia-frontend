/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surf: {
          dark: '#0a0a0a',
          light: '#f8f9fa',
        }
      }
    },
  },
  plugins: [],
}
