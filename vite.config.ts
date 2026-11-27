import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Served from https://edenaz7.github.io/sportmatch/
export default defineConfig({
  base: '/sportmatch/',
  plugins: [react(), tailwindcss()],
})
