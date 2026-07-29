// ═══════════════════════════════════════════════════════════
//  LINE IMPORTS — verify vendored Line2/LineMaterial resolve
// ═══════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

describe('vendored line addons', () => {
  it('Line2 is importable from three/addons/lines/Line2.js', async () => {
    const { Line2 } = await import('three/addons/lines/Line2.js');
    expect(Line2).toBeDefined();
    expect(typeof Line2).toBe('function');
  });

  it('LineMaterial is importable from three/addons/lines/LineMaterial.js', async () => {
    const { LineMaterial } = await import('three/addons/lines/LineMaterial.js');
    expect(LineMaterial).toBeDefined();
    expect(typeof LineMaterial).toBe('function');
  });

  it('Line2 can be instantiated with geometry and material', async () => {
    const { Line2 } = await import('three/addons/lines/Line2.js');
    const { LineMaterial } = await import('three/addons/lines/LineMaterial.js');

    const geo = {};
    const mat = new LineMaterial({ color: new THREE.Color(0xff0000), linewidth: 2 });
    const line = new Line2(geo, mat);

    expect(line.geometry).toBe(geo);
    expect(line.material).toBe(mat);
  });

  it('LineMaterial accepts linewidth and resolution', async () => {
    const { LineMaterial } = await import('three/addons/lines/LineMaterial.js');

    const res = new THREE.Vector2(1920, 1080);
    const mat = new LineMaterial({
      color: new THREE.Color(0x00ff00),
      linewidth: 5,
      resolution: res,
    });

    expect(mat.linewidth).toBe(5);
    expect(mat.resolution).toBe(res);
  });
});
