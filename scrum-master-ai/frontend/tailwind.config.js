/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Fira Code', 'monospace'],
      },
      colors: {
        // Semantic accents on top of Tailwind's base palette — kept
        // deliberately small (two colors) rather than a full custom
        // palette, so every existing gray-9xx/violet-6xx usage stays valid
        // while these carry specific meaning: 'brand' for actions you take,
        // 'live' for things happening right now (an active call, a running
        // schedule) — distinct signals instead of one accent doing both jobs.
        brand: {
          DEFAULT: '#7c5cff',
          hover: '#8f72ff',
          subtle: 'rgba(124,92,255,0.12)',
        },
        live: {
          DEFAULT: '#ff6b57',
          subtle: 'rgba(255,107,87,0.12)',
        },
      },
    },
  },
  plugins: [],
};
