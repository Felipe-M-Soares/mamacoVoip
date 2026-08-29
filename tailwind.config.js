/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        discord: {
          brand: '#5865F2',
          'brand-hover': '#4752C4',
          gray: '#36393F',
          'gray-dark': '#2F3136',
          'gray-darker': '#202225',
          'gray-light': '#40444B',
        },
      },
    },
  },
  plugins: [],
};
