import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Served from the site root by default (dev). A GitHub Pages build serves the
  // project under /digital-substation-sim/, so its workflow will set VITE_BASE.
  base: process.env.VITE_BASE || '/',
  server: {
    port: 5174,
    // Allow the dev server to be reached through Tailscale Serve (*.ts.net)
    allowedHosts: ['.ts.net'],
  },
})
