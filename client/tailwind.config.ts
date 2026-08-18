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
        // ── Voice bot tokens (unchanged from scrum-master-ai) ──
        brand: {
          DEFAULT: '#7c5cff',
          hover: '#8f72ff',
          subtle: 'rgba(124,92,255,0.12)',
        },
        live: {
          DEFAULT: '#ff6b57',
          subtle: 'rgba(255,107,87,0.12)',
        },
        // ── Config dashboard tokens (mapped 1:1 from agent-bridge's
        // CSS custom properties in index.css, so pages that keep using
        // var(--c-blue) etc. and pages migrated to Tailwind utilities
        // render identically) ──
        'config-blue': '#3B82F6',
        'config-green': '#10B981',
        'config-amber': '#F59E0B',
        'config-red': '#EF4444',
        'config-violet': '#8B5CF6',
      },
    },
  },
  plugins: [],
}
