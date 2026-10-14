import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/health': backend,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: app deploys don't invalidate cached libraries.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
            { name: 'motion', test: /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion|gsap|@gsap)[\\/]/ },
            { name: 'ui', test: /node_modules[\\/](@radix-ui|radix-ui|@floating-ui|cmdk|sonner|@phosphor-icons|tailwind-merge|clsx)[\\/]/ },
            { name: 'data', test: /node_modules[\\/](@tanstack|zustand)[\\/]/ },
          ],
        },
      },
    },
  },
})
