// ═══════════════════════════════════════════════════════════
//  VENDOR LINES — verify all vendored line addon files exist
// ═══════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vendorDir = resolve(__dirname, '../../client/vendor/three/examples/jsm/lines');

const requiredFiles = [
  'Line2.js',
  'LineGeometry.js',
  'LineMaterial.js',
  'LineSegments2.js',
  'LineSegmentsGeometry.js',
];

describe('vendored line addons', () => {
  for (const fname of requiredFiles) {
    it(`${fname} exists and is non-empty`, () => {
      const content = readFileSync(resolve(vendorDir, fname), 'utf8');
      expect(content.length).toBeGreaterThan(50);
    });
  }

  it('Line2.js imports LineSegments2, LineGeometry, LineMaterial', () => {
    const content = readFileSync(resolve(vendorDir, 'Line2.js'), 'utf8');
    expect(content).toContain('LineSegments2');
    expect(content).toContain('LineGeometry');
    expect(content).toContain('LineMaterial');
  });

  it('LineSegments2.js imports LineSegmentsGeometry', () => {
    const content = readFileSync(resolve(vendorDir, 'LineSegments2.js'), 'utf8');
    expect(content).toContain('LineSegmentsGeometry');
  });

  it('LineGeometry.js imports LineSegmentsGeometry', () => {
    const content = readFileSync(resolve(vendorDir, 'LineGeometry.js'), 'utf8');
    expect(content).toContain('LineSegmentsGeometry');
  });
});
