import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSrc = () => readFileSync(join(__dirname, '../../client/app.js'), 'utf-8');

describe('Portrait FOV adjustment', () => {
  it('sets FOV to 87 in portrait orientation', () => {
    expect(appSrc()).toContain('? 87 : 50');
  });

  it('calls updateCameraFov after camera setup', () => {
    const src = appSrc();
    expect(src).toContain('function updateCameraFov()');
    const lookAtIdx = src.indexOf('camera.lookAt');
    // Find the standalone call (not the function definition)
    const callMatch = src.match(/\nupdateCameraFov\(\)/);
    expect(callMatch).not.toBeNull();
    expect(callMatch.index).toBeGreaterThan(lookAtIdx);
  });

  it('calls updateCameraFov on resize', () => {
    expect(appSrc()).toMatch(/addEventListener\('resize'[\s\S]*updateCameraFov/);
  });
});
