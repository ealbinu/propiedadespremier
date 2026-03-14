export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Paleta neo-brutalist - tonos urbanos
        'concrete': {
          50: '#f7f7f7',
          100: '#e3e3e3',
          200: '#c8c8c8',
          300: '#a4a4a4',
          400: '#818181',
          500: '#666666',
          600: '#515151',
          700: '#434343',
          800: '#383838',
          900: '#2d2d2d',
          950: '#1a1a1a',
        },
        'asphalt': {
          DEFAULT: '#2f2f2f',
          light: '#4a4a4a',
          dark: '#1a1a1a',
        },
        'signal': {
          yellow: '#f7c600',
          white: '#ffffff',
          black: '#000000',
        }
      },
      fontFamily: {
        'mono': ['IBM Plex Mono', 'monospace'],
        'sans': ['Inter', 'system-ui', 'sans-serif'],
      },
      borderWidth: {
        '3': '3px',
        '4': '4px',
      }
    },
  },
  plugins: [],
}