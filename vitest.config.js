import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'three': path.resolve(__dirname, 'test/client/mocks/three.js'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/client/**/*.test.js'],
    setupFiles: ['test/client/setup.js'],
  },
});
