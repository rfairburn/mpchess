import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'three/addons/loaders/STLLoader.js': path.resolve(
        __dirname,
        'test/client/mocks/stl_loader.js'
      ),
      'three/addons/loaders/FontLoader.js': path.resolve(
        __dirname,
        'test/client/mocks/font_loader.js'
      ),
      'three/addons/geometries/TextGeometry.js': path.resolve(
        __dirname,
        'test/client/mocks/text_geometry.js'
      ),
      three: path.resolve(__dirname, 'test/client/mocks/three.js'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/client/**/*.test.js', 'test/shared/**/*.test.js'],
    setupFiles: ['test/client/setup.js'],
  },
});
