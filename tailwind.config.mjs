/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx}",
    "./src/ui/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#05070b",
          900: "#0a0f1a",
        },
        neon: {
          100: "#dbe7ff",
          300: "#8fb2ff",
          400: "#5f8dff",
          500: "#4f7dff",
          600: "#2d5bff",
        },
        aqua: {
          300: "#6ff5e6",
          400: "#2ce6d6",
        },
      },
      boxShadow: {
        glow: "0 0 30px rgba(79,125,255,0.18)",
        neon: "0 0 18px rgba(79,125,255,0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
