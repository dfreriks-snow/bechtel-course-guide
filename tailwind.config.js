/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Scouting America / outdoors palette
        forest: "#1b5e3f",
        forestDk: "#0f3d28",
        khaki: "#d9c9a3",
        sun: "#f5b301",
        ink: "#12211a",
        panel: "#182c22",
        card: "#1f3a2c",
        border: "#2c4d3b",
        muted: "#8fb3a0",
        pale: "#d7e8dd",
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};
