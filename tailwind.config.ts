/** @type {import('tailwindcss').Config} */
export default {
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
      extend: {
        colors: {
          // Púrpura de marca LucyCare (Manual de Marca). Reintroducido de forma
          // controlada como token para no hardcodear el hex en clases inline y
          // dejar base para el equilibrio de marca futuro.
          brand: {
            purple: {
              DEFAULT: '#3C2285',
              dark: '#2d1a64',
            },
            // Menta/turquesa de marca (Manual de Marca). Uso como ACENTO
            // (fondos suaves, badges, bordes, hovers), nunca como CTA sólido:
            // es un tono claro, así que sobre él el texto debe ir oscuro
            // (`text-brand-purple`) para mantener contraste AA.
            mint: {
              DEFAULT: '#8AE4CB',
            },
            // Gris claro de marca para superficies neutras (footer, fondos).
            gray: {
              DEFAULT: '#EDEDED',
            },
          },
        },
      },
    },
    plugins: [],
  }