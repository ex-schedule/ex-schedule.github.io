import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) return 'motion';
          if (id.includes('node_modules/lucide-react')) return 'icons';
          if (id.includes('node_modules/react-dom')) return 'react-dom';
          if (id.includes('node_modules/')) return 'vendor';
          if (id.includes('/src/components/')) return 'components';
          if (id.includes('/src/utils/') || id.includes('/src/constants')) return 'core';
        },
      },
    },
  },
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:3217' } },
});
