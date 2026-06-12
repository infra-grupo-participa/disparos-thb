import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Marca (laranja Grupo Participa/advmais) com escala completa para
        // hierarquia consistente. Base na paleta orange — #f97316 (accent-1) e
        // #ea580c (accent-2) são as cores oficiais usadas nos demais projetos.
        brand: {
          DEFAULT: "#ea580c",
          light: "#f97316",
          50: "#fff7ed",
          100: "#ffedd5",
          200: "#fed7aa",
          300: "#fdba74",
          400: "#fb923c",
          500: "#f97316",
          600: "#ea580c",
          700: "#c2410c",
          800: "#9a3412",
          900: "#7c2d12",
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
