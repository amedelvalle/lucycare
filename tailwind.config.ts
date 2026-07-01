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
          },
        },
      },
    },
    plugins: [],
  }