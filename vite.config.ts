import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173
  },
  plugins: [
    tailwindcss(),
    react()
  ],
  base: './', // مسار نسبي ليضمن عمل التطبيق على أي استضافة بدون أخطاء 404
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'motion'],
        },
      },
    },
  },
});