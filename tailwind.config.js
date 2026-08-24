/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.html", "./*.js"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Poppins", "sans-serif"],
      },
      colors: {
        ink: "#10224d",
        brand: {
          DEFAULT: "#f97316",
          orange: "#f97316",
          blue: "#1e3a8a",
        },
      },
    },
  },
  plugins: [],
};
