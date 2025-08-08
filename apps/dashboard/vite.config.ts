import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { resolve } from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [viteReact(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api/jira': {
        target: 'https://clubcashin.atlassian.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/jira/, ''),
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq) => {
            // Usar las credenciales del .env
            const email = process.env.VITE_JIRA_EMAIL || ''
            const token = process.env.VITE_JIRA_API_TOKEN || ''
            const auth = Buffer.from(`${email}:${token}`).toString('base64')
            
            proxyReq.setHeader('Authorization', `Basic ${auth}`)
            proxyReq.setHeader('Accept', 'application/json')
            proxyReq.setHeader('Content-Type', 'application/json')
          })
        }
      }
    }
  }
})
