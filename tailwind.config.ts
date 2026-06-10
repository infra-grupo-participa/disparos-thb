import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Marca (azul-marinho) com escala completa para hierarquia consistente.
        brand: {
          DEFAULT: "#1e3a5f",
          light: "#2c5282",
          50: "#f1f5fa",
          100: "#dde8f3",
          200: "#bcd0e6",
          300: "#8fb0d4",
          400: "#5d88bd",
          500: "#3a6aa0",
          600: "#2c5282",
          700: "#1e3a5f",
          800: "#1a2f4a",
          900: "#16273d",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        soft: "0 6px 20px -4px rgb(15 23 42 / 0.10)",
        pop: "0 12px 32px -8px rgb(15 23 42 / 0.18)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
