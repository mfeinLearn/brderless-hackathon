import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.API_PORT ?? process.env.API_PORT ?? '3001';
  return {
    plugins: [react()],
    // Plain CSS only — keep Vite from searching parent dirs for a PostCSS config.
    css: {
      postcss: { plugins: [] },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    },
  };
});
