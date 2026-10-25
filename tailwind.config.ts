import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#FAF8F5',
        surface: '#FFFFFF',
        subtle: '#F3EFEA',
        stoneline: '#E4DFD7',
        cedar: {
          DEFAULT: '#14532D',
          hover: '#166534',
          light: '#DCFCE7',
          subtle: '#F0FDF4',
        },
        hunter: {
          DEFAULT: '#C2410C',
          hover: '#9A3412',
          light: '#FFEDD5',
          subtle: '#FFF7ED',
        },
        ink: {
          DEFAULT: '#1C1917',
          secondary: '#57534E',
          muted: '#78716C',
        },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
