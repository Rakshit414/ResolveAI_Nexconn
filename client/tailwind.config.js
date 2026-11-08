/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#060A13',
          900: '#0B1120',
          850: '#0F172A',
          800: '#151F38',
          750: '#1C294B',
          700: '#23335D',
          600: '#33487C',
        },
        brand: {
          blue: '#3B82F6',
          indigo: '#6366F1',
          violet: '#8B5CF6',
          purple: '#A855F7',
          cyan: '#06B6D4',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        'glow-sm': '0 0 15px -3px rgba(99, 102, 241, 0.25)',
        'glow-md': '0 0 25px -5px rgba(99, 102, 241, 0.35)',
        'glow-blue': '0 0 20px -5px rgba(59, 130, 246, 0.3)',
      }
    },
  },
  plugins: [],
}
