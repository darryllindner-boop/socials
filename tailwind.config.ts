import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          500: "#2f6df6",
          600: "#1f57d6",
          700: "#1b46a8",
        },
      },
    },
  },
  plugins: [],
};

export default config;
