import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Marca com escala completa para hierarquia consistente. O DEFAULT
        // continua sendo o laranja Grupo Participa/advmais (#ea580c / #f97316),
        // mas agora via CSS var: quem define o valor é app/globals.css, e cada
        // portal pode sobrescrever a paleta inteira com [data-tema="..."] no
        // <html> (ver o tema "aurum", dourado). O `<alpha-value>` é obrigatório
        // — sem ele, utilitários como bg-brand/5 e ring-brand/40 perdem a
        // opacidade em silêncio.
        brand: {
          DEFAULT: "rgb(var(--brand-DEFAULT) / <alpha-value>)",
          light: "rgb(var(--brand-light) / <alpha-value>)",
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "rgb(var(--brand-300) / <alpha-value>)",
          400: "rgb(var(--brand-400) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
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
