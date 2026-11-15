import { svelte } from '@sveltejs/vite-plugin-svelte';
import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest(), svelte()],
  resolve: { conditions: ['browser'] }, // svelte client build, not the SSR one
  test: {
    environment: 'happy-dom',
    pool: 'vmThreads',
    setupFiles: ['src/test-setup.ts'],
    // packages/mcp-server runs in node with its own config (pnpm test chains it)
    exclude: [...configDefaults.exclude, 'packages/**', 'promo/**'],
  },
});
