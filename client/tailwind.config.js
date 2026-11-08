/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Final Resolve AI Brand Colour Palette
        jet: {
          DEFAULT: '#090909', // Jet Black - dominant interface background
          deep: '#0E0E0E',    // Navigation, sidebar, header surfaces
          elevated: '#161616',// Cards, panels, message bubbles
          surface: '#1F1F1F', // Dropdowns, hovered items
          hover: '#262626',   // Hover state
        },
        neon: {
          DEFAULT: '#7CFF00', // Neon Fluorescent Lime Green - primary signature accent
          hover: '#8EFF1F',   // Electric hover
          active: '#6AE600',  // Pressed active
          dim: 'rgba(124, 255, 0, 0.12)', // Subtle highlight background
          border: 'rgba(124, 255, 0, 0.35)', // Subtle accent border
        },
        pure: {
          white: '#FFFFFF',   // Pure White - typography
        },
        txt: {
          primary: '#FFFFFF', // High-contrast primary text
          secondary: '#C8C8C8', // Secondary clear text
          muted: '#8A8A8A',   // Timestamps, helper metadata
          dim: '#555555',     // Very dim text
        },
        border: {
          subtle: '#222222',  // Minimal card and section dividers
          divider: '#1A1A1A', // Dark divider
          accent: '#7CFF00',  // Accent border
        },
        alert: {
          red: '#FF334B',     // Critical alert indicator
          subtle: '#250C10',  // Urgent alert background
          border: '#5C151F',  // Urgent alert border
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        'neon-sm': '0 0 10px -2px rgba(124, 255, 0, 0.35)',
        'neon-md': '0 0 20px -3px rgba(124, 255, 0, 0.40)',
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
