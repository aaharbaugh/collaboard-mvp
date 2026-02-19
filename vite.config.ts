import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const projectId = env.VITE_FIREBASE_PROJECT_ID || 'collab-together-111'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/agent': {
          target: `http://127.0.0.1:5001`,
          changeOrigin: true,
          rewrite: () => `/${projectId}/us-central1/executeAgentCommand`,
        },
      },
    },
  }
})
