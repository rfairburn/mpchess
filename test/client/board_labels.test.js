import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createLabels } from '../../client/board.js';

describe('createLabels', () => {
  let scene, font;

  beforeEach(() => {
    scene = new THREE.Scene();
    font = {};
  });

  it('creates file labels on both bottom and top sides', () => {
    createLabels(scene, font);

    // 8 file labels bottom + 8 file labels top + 8 rank labels left + 8 rank labels right = 32
    const meshes = scene.children.filter((c) => c instanceof THREE.Mesh);
    expect(meshes.length).toBe(32);

    // Bottom file labels: z ≈ 4.15, rotation.z ≈ 0
    const bottomFiles = meshes.filter(
      (m) => Math.abs(m.position.z - 4.15) < 0.01 && Math.abs(m.rotation.z) < 0.01
    );
    expect(bottomFiles.length).toBe(8);
    expect(bottomFiles.map((m) => +(m.position.x + 0).toFixed(1))).toEqual([
      -3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5,
    ]);

    // Top file labels: z ≈ -4.15, rotation.z ≈ π (flipped)
    const topFiles = meshes.filter(
      (m) =>
        Math.abs(m.position.z + 4.15) < 0.01 && Math.abs(Math.abs(m.rotation.z) - Math.PI) < 0.01
    );
    expect(topFiles.length).toBe(8);
    expect(topFiles.map((m) => +(m.position.x + 0).toFixed(1))).toEqual([
      -3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5,
    ]);
  });

  it('creates rank labels on both left and right sides', () => {
    createLabels(scene, font);

    const meshes = scene.children.filter((c) => c instanceof THREE.Mesh);

    // Left rank labels: x ≈ -4.15, rotation.z ≈ -π/2
    const leftRanks = meshes.filter(
      (m) => Math.abs(m.position.x + 4.15) < 0.01 && Math.abs(m.rotation.z + Math.PI / 2) < 0.01
    );
    expect(leftRanks.length).toBe(8);
    expect(leftRanks.map((m) => +(m.position.z + 0).toFixed(1))).toEqual([
      3.5, 2.5, 1.5, 0.5, -0.5, -1.5, -2.5, -3.5,
    ]);

    // Right rank labels: x ≈ 4.15, rotation.z ≈ π/2
    const rightRanks = meshes.filter(
      (m) => Math.abs(m.position.x - 4.15) < 0.01 && Math.abs(m.rotation.z - Math.PI / 2) < 0.01
    );
    expect(rightRanks.length).toBe(8);
    expect(rightRanks.map((m) => +(m.position.z + 0).toFixed(1))).toEqual([
      3.5, 2.5, 1.5, 0.5, -0.5, -1.5, -2.5, -3.5,
    ]);
  });
});
