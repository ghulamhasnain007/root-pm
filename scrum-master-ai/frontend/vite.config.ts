import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import 'dotenv/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: process.env.VITE_BACKEND_API , ws: true },
      '/health': { target: process.env.VITE_BACKEND_API },
      '/integrations': { target: process.env.VITE_BACKEND_API },
    },
  },
});
