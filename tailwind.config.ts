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
        // Sombras em camadas e sutis (estilo produto — Linear/Stripe), sempre
        // acompanhadas de uma borda fina para definir a superfície.
        xs: "0 1px 2px 0 rgb(15 23 42 / 0.05)",
        card: "0 1px 1px 0 rgb(15 23 42 / 0.04), 0 2px 4px -2px rgb(15 23 42 / 0.05)",
        soft: "0 2px 4px -2px rgb(15 23 42 / 0.06), 0 6px 16px -4px rgb(15 23 42 / 0.10)",
        pop: "0 4px 12px -4px rgb(15 23 42 / 0.12), 0 16px 40px -12px rgb(15 23 42 / 0.24)",
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
