/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand permanent colour system
        charcoal: {
          DEFAULT: '#191A19', // Main background
          deep: '#111311',    // Navigation and sidebar background
          elevated: '#242724',// Cards and elevated panels
          surface: '#1E211E', // Secondary surface
        },
        forest: {
          DEFAULT: '#174B35', // Primary interactions and active elements
          hover: '#1F6246',   // Hover state
          active: '#133D2B',  // Active pressed state
          subtle: '#142E22',  // Subtle background highlight
          border: '#235D43',  // Active border
        },
        crimson: {
          DEFAULT: '#A51F32', // Critical alerts and urgent states
          hover: '#BE253B',   // Hover state
          subtle: '#2A1316',  // Subtle background for critical
          border: '#5C1721',  // Border for critical
        },
        txt: {
          primary: '#D5D9D3', // Primary main content text
          muted: '#929A91',   // Secondary muted information
          dim: '#687267',     // Dim helper text
        },
        subtle: {
          border: '#353B35',  // Dividers and card borders
          divider: '#2A302A', // Lighter divider
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        'sm': '4px',
        'DEFAULT': '6px',
        'md': '8px',
        'lg': '10px',
        'xl': '12px',
      }
    },
  },
  plugins: [],
}
