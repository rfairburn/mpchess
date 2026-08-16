// ═══════════════════════════════════════════════════════════
//  3D BOARD — dashed premove system arrow (Phase 3C)
//  Focused geometry tests: dash segmentation on straight and
//  knight/bent paths (dashes crossing a bend follow the bend via the
//  bend vertex, no diagonal shortcut), continuous path endpoints, solid
//  arrowhead, screen-space width updates, annotation isolation
//  (identical endpoints, clear/toggle), replace, state restore, and
//  explicit geometry/material dispose counts (no accumulation), plus
//  teardown: post-dispose state changes create nothing and re-init
//  restores exactly one arrow with fresh resources.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../client/network.js', () => ({
  onEvaluation: vi.fn(),
  serverEvaluation: null,
  serverBoard: null,
  serverTurn: 'white',
  previousMove: null,
}));
vi.mock('../../shared/chess.mjs', () => ({
  findKing: vi.fn(),
  isInCheck: vi.fn(),
}));

// The real arrows.js (real getArrowPath knight bending) and the real
// premove.js drive the system arrow; annotation state is exercised
// through the real addArrow/clearArrows.

describe('3D board — dashed premove arrow (Phase 3C)', () => {
  let THREE, board, premove, arrows;
  let scene, camera;

  // e2–e4 straight premove: world origin (0.5, 2.5), tip (0.5, 0.5)
  const PRE = { fromFile: 4, fromRank: 1, toFile: 4, toRank: 3 };
  // a1–c2 knight premove: path (-3.5,3.5) → (-1.5,3.5) → (-1.5,2.5)
  const KNIGHT = { fromFile: 0, fromRank: 0, toFile: 2, toRank: 1 };

  beforeEach(async () => {
    vi.resetModules();
    THREE = await import('three');
    board = await import('../../client/board.js');
    premove = await import('../../client/premove.js');
    arrows = await import('../../client/arrows.js');
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 10, 0);
    board.initArrows3D(scene, camera);
  });

  afterEach(() => {
    premove.clearPremove();
    arrows.clearArrows();
    board.disposeArrows3D();
  });

  function premoveGroup() {
    return scene.children.find((c) => c.name === 'premoveArrowGroup');
  }

  function annotationGroup() {
    return scene.children.find((c) => c.name === 'arrowGroup');
  }

  function premoveMesh() {
    return premoveGroup().children[0];
  }

  function verts(mesh) {
    const arr = mesh.geometry.attributes.position.array;
    return (i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
  }

  // ── Presence / color ────────────────────────────────────

  it('renders no system arrow without a confirmed premove', () => {
    expect(premoveGroup()).toBeDefined();
    expect(premoveGroup().children).toHaveLength(0);
  });

  it('uses the deep royal blue premove hue 0x1e5ac8 (not the bright Alt annotation blue)', () => {
    premove.setPremove(PRE);
    const mesh = premoveMesh();
    const c = mesh.material.color;
    expect(c.r).toBeCloseTo(0x1e / 255, 5);
    expect(c.g).toBeCloseTo(0x5a / 255, 5);
    expect(c.b).toBeCloseTo(0xc8 / 255, 5);
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.depthWrite).toBe(false);
  });

  it('repeated premove changes never produce more than one system arrow', () => {
    premove.setPremove(PRE);
    premove.setPremove(KNIGHT);
    premove.setPremove(PRE);
    premove.setPremove({ ...PRE, promotion: 'queen' });
    expect(premoveGroup().children).toHaveLength(1);
  });

  // ── Dash segmentation ───────────────────────────────────

  it('splits a straight body into dash intervals with gaps between them', () => {
    premove.setPremove(PRE);
    const mesh = premoveMesh();
    expect(premoveGroup().children).toHaveLength(1);

    const { dashSegments, head } = mesh.userData;
    // body length = 2 squares - HEAD_LEN (0.25) = 1.75
    // dashes: [0,0.24] [0.36,0.60] [0.72,0.96] [1.08,1.32] [1.44,1.68]
    const expected = [
      [0, 0.24],
      [0.36, 0.6],
      [0.72, 0.96],
      [1.08, 1.32],
      [1.44, 1.68],
    ];
    expect(dashSegments.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      const seg = dashSegments[i];
      // straight path: every dash is a 2-point polyline
      expect(seg).toHaveLength(2);
      // path runs along -z from (0.5, 2.5); arc s ↔ z = 2.5 - s
      expect(seg[0].x).toBeCloseTo(0.5, 6);
      expect(seg.at(-1).x).toBeCloseTo(0.5, 6);
      expect(seg[0].z).toBeCloseTo(2.5 - expected[i][0], 6);
      expect(seg.at(-1).z).toBeCloseTo(2.5 - expected[i][1], 6);
    }
    // consecutive dashes are separated by exactly the gap length
    for (let i = 1; i < dashSegments.length; i++) {
      expect(dashSegments[i - 1].at(-1).z - dashSegments[i][0].z).toBeCloseTo(
        board.PREMOVE_GAP_LEN,
        6
      );
    }
    // the last dash stops before the arrowhead base
    expect(dashSegments.at(-1).at(-1).z).toBeGreaterThan(head.z);
    expect(head.z).toBeCloseTo(0.75, 6); // body end = tip + HEAD_LEN
  });

  it('emits ribbon quads only for dash intervals plus a solid arrowhead triangle', () => {
    premove.setPremove(PRE);
    const mesh = premoveMesh();
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const dashSegments = mesh.userData.dashSegments;
    const totalPts = dashSegments.reduce((sum, seg) => sum + seg.length, 0);
    const totalSegs = dashSegments.reduce((sum, seg) => sum + (seg.length - 1), 0);

    // 2 vertices per dash point + 3 arrowhead vertices
    expect(pos.array.length / 3).toBe(totalPts * 2 + 3);
    // 2 triangles per dash sub-segment + 1 arrowhead triangle
    expect(idx.length).toBe(totalSegs * 6 + 3);

    // first dash quad: origin (0.5, 2.5) ± unit perpendicular (1, 0)
    const v = verts(mesh);
    expect(v(0)[0]).toBeCloseTo(1.5, 6);
    expect(v(0)[2]).toBeCloseTo(2.5, 6);
    expect(v(1)[0]).toBeCloseTo(-0.5, 6);
    expect(v(1)[2]).toBeCloseTo(2.5, 6);
    // all vertices sit at the arrow height
    for (let i = 0; i < pos.array.length; i += 3) {
      expect(pos.array[i + 1]).toBeCloseTo(0.065, 6);
    }
  });

  it('segments a knight (bent) path along both segments, including a dash crossing the bend', () => {
    premove.setPremove(KNIGHT);
    const mesh = premoveMesh();
    const { dashSegments, head } = mesh.userData;

    // first dash starts at the origin (-3.5, 3.5)
    expect(dashSegments[0][0].x).toBeCloseTo(-3.5, 6);
    expect(dashSegments[0][0].z).toBeCloseTo(3.5, 6);

    // every dash point lies on one of the two centerline segments
    for (const seg of dashSegments) {
      for (const p of seg) {
        const onSeg1 = Math.abs(p.z - 3.5) < 1e-9;
        const onSeg2 = Math.abs(p.x + 1.5) < 1e-9;
        expect(onSeg1 || onSeg2).toBe(true);
      }
    }

    // at least one dash crosses the bend (endpoints on different segments)
    const crossing = dashSegments.find(
      (s) => Math.abs(s[0].z - 3.5) < 1e-9 !== Math.abs(s.at(-1).z - 3.5) < 1e-9
    );
    expect(crossing).toBeDefined();

    // the crossing dash includes the bend vertex exactly, so the ribbon
    // follows the bend instead of shortcutting the corner diagonally
    expect(crossing).toHaveLength(3); // start, bend, end
    const bend = crossing[1];
    expect(bend.x).toBeCloseTo(-1.5, 6);
    expect(bend.z).toBeCloseTo(3.5, 6);
    // 90° bend: miter perpendicular = (1, 1) (bisector * 2/||p1+p2||)
    expect(bend.px).toBeCloseTo(1, 6);
    expect(bend.pz).toBeCloseTo(1, 6);
    // sub-segments stay on their centerline segments: start→bend along
    // segment 1, bend→end along segment 2
    expect(crossing[0].z).toBeCloseTo(3.5, 6);
    expect(crossing.at(-1).x).toBeCloseTo(-1.5, 6);
    // contiguous dash geometry: the bend insertion does not shift the
    // arc-length tiling — the polyline length equals the dash interval
    // length and the gaps to the neighboring dashes are preserved
    let polylineLen = 0;
    for (let i = 1; i < crossing.length; i++) {
      polylineLen += Math.hypot(
        crossing[i].x - crossing[i - 1].x,
        crossing[i].z - crossing[i - 1].z
      );
    }
    expect(polylineLen).toBeCloseTo(board.PREMOVE_DASH_LEN, 6);
    const ci = dashSegments.indexOf(crossing);
    if (ci > 0) {
      const prevEnd = dashSegments[ci - 1].at(-1);
      expect(Math.hypot(crossing[0].x - prevEnd.x, crossing[0].z - prevEnd.z)).toBeCloseTo(
        board.PREMOVE_GAP_LEN,
        6
      );
    }
    if (ci < dashSegments.length - 1) {
      const nextStart = dashSegments[ci + 1][0];
      expect(
        Math.hypot(nextStart.x - crossing.at(-1).x, nextStart.z - crossing.at(-1).z)
      ).toBeCloseTo(board.PREMOVE_GAP_LEN, 6);
    }

    // the last dash ends on the second segment, at or before the head base
    // (the tiling can land exactly on the body end)
    const last = dashSegments.at(-1);
    expect(last.at(-1).x).toBeCloseTo(-1.5, 6);
    expect(last.at(-1).z).toBeGreaterThanOrEqual(head.z - 1e-9);

    // arrowhead: base at the body end (-1.5, 2.75), tip at the destination
    expect(head.x).toBeCloseTo(-1.5, 6);
    expect(head.z).toBeCloseTo(2.75, 6);
    expect(head.tipX).toBeCloseTo(-1.5, 6);
    expect(head.tipZ).toBeCloseTo(2.5, 6);
  });

  it('uses the miter perpendicular when a dash endpoint lands exactly on a bend', () => {
    // 90° bend at arc length 1.0; a dash length of 1.0 puts the endpoint
    // exactly on the bend vertex.
    const worldPoints = [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: -1 },
    ];
    const { userData } = board.buildDashedPathGeometry(worldPoints, 0.065, 1.0, 1.0);
    expect(userData.dashSegments).toHaveLength(1);
    const seg = userData.dashSegments[0];
    // endpoint on the bend: no interior vertex is duplicated
    expect(seg).toHaveLength(2);
    expect(seg[0].x).toBeCloseTo(0, 6);
    expect(seg[0].z).toBeCloseTo(0, 6);
    expect(seg.at(-1).x).toBeCloseTo(1, 6);
    expect(seg.at(-1).z).toBeCloseTo(0, 6);
    // start: plain segment perpendicular (0, 1)
    expect(seg[0].px).toBeCloseTo(0, 6);
    expect(seg[0].pz).toBeCloseTo(1, 6);
    // bend: miter = bisector extended by 2/||p1+p2|| → (1, 1) for 90°
    expect(seg.at(-1).px).toBeCloseTo(1, 6);
    expect(seg.at(-1).pz).toBeCloseTo(1, 6);
    expect(Math.hypot(seg.at(-1).px, seg.at(-1).pz)).toBeCloseTo(Math.SQRT2, 6);
  });

  it('dash intervals tile the body centerline continuously (no overlaps, no missing coverage)', () => {
    const worldPoints = [
      { x: 0, z: 3 },
      { x: 0, z: 0 },
    ];
    const { userData } = board.buildDashedPathGeometry(worldPoints, 0.065, 0.3, 0.2);
    // body length = 3 - 0.25 = 2.75
    const expected = [
      [0, 0.3],
      [0.5, 0.8],
      [1.0, 1.3],
      [1.5, 1.8],
      [2.0, 2.3],
      [2.5, 2.75],
    ];
    expect(userData.dashSegments.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      const seg = userData.dashSegments[i];
      // z decreases from 3 to 0.25; arc s ↔ z = 3 - s
      expect(seg[0].z).toBeCloseTo(3 - expected[i][0], 6);
      expect(seg.at(-1).z).toBeCloseTo(3 - expected[i][1], 6);
    }
    // consecutive dashes are separated by exactly the gap
    for (let i = 1; i < userData.dashSegments.length; i++) {
      expect(userData.dashSegments[i - 1].at(-1).z - userData.dashSegments[i][0].z).toBeCloseTo(
        0.2,
        6
      );
    }
    // first dash starts at the origin; last dash ends at or before the body end
    expect(userData.dashSegments[0][0].z).toBeCloseTo(3, 6);
    expect(userData.dashSegments.at(-1).at(-1).z).toBeGreaterThanOrEqual(0.25 - 1e-9);
  });

  // ── Solid arrowhead ─────────────────────────────────────

  it('keeps a solid arrowhead: one triangle at the tip, base at the body end', () => {
    premove.setPremove(PRE);
    const mesh = premoveMesh();
    const idx = mesh.geometry.index;
    const totalPts = mesh.userData.dashSegments.reduce((sum, seg) => sum + seg.length, 0);
    const headStart = totalPts * 2;
    const v = verts(mesh);

    // tip at the destination square center
    const tip = v(headStart + 2);
    expect(tip[0]).toBeCloseTo(0.5, 6);
    expect(tip[2]).toBeCloseTo(0.5, 6);
    // base corners at the body end (0.5, 0.75) ± perp * HEAD_HALF_W_RATIO
    const b0 = v(headStart);
    const b1 = v(headStart + 1);
    expect(b0[0]).toBeCloseTo(2.0, 6);
    expect(b0[2]).toBeCloseTo(0.75, 6);
    expect(b1[0]).toBeCloseTo(-1.0, 6);
    expect(b1[2]).toBeCloseTo(0.75, 6);
    // the head triangle is the last index triple, referencing only head verts
    expect(idx.slice(-3)).toEqual([headStart, headStart + 1, headStart + 2]);
    for (const i of idx.slice(0, -3)) {
      expect(i).toBeLessThan(headStart);
    }
  });

  // ── Screen-space width updates ──────────────────────────

  it('updates screen-space width with camera distance (dashes and head scale together)', () => {
    premove.setPremove(PRE);
    const mesh = premoveMesh();
    const v = verts(mesh);
    const totalPts = mesh.userData.dashSegments.reduce((sum, seg) => sum + seg.length, 0);
    const headStart = totalPts * 2;

    camera.position.set(0, 10, 0);
    board.updateAllArrowWidths();
    const hw1 = Math.abs(v(0)[0] - 0.5);
    const headHw1 = Math.abs(v(headStart)[0] - 0.5) / 1.5;

    camera.position.set(0, 5, 0);
    board.updateAllArrowWidths();
    const hw2 = Math.abs(v(0)[0] - 0.5);
    const headHw2 = Math.abs(v(headStart)[0] - 0.5) / 1.5;

    expect(hw2).toBeCloseTo(hw1 / 2, 6);
    expect(headHw2).toBeCloseTo(headHw1 / 2, 6);
    // the tip stays anchored at the destination
    const tip = v(headStart + 2);
    expect(tip[0]).toBeCloseTo(0.5, 6);
    expect(tip[2]).toBeCloseTo(0.5, 6);
  });

  it('width responds to viewport height changes (camera resize)', () => {
    premove.setPremove(PRE);
    const mesh = premoveMesh();
    const pos = mesh.geometry.attributes.position;
    camera.position.set(0, 10, 0);

    const h1 = window.innerHeight;
    board.updateAllArrowWidths();
    const hw1 = Math.abs(pos.array[0] - 0.5);
    window.innerHeight = h1 * 2;
    board.updateAllArrowWidths();
    const hw2 = Math.abs(pos.array[0] - 0.5);
    window.innerHeight = h1;

    expect(hw2).toBeCloseTo(hw1 / 2, 6);
  });

  // ── Annotation isolation ────────────────────────────────

  it('an annotation with identical endpoints coexists; clear/toggle never touches the premove arrow', () => {
    premove.setPremove(PRE);
    const preMesh = premoveMesh();
    const preGeo = preMesh.geometry;
    const preMat = preMesh.material;

    // annotation arrow with the same endpoints
    arrows.addArrow({ file: 4, rank: 1 }, { file: 4, rank: 3 }, '#4488ff');
    expect(annotationGroup().children).toHaveLength(1);
    expect(premoveGroup().children).toHaveLength(1);
    expect(premoveGroup().children[0]).toBe(preMesh);
    expect(annotationGroup().children[0].geometry).not.toBe(preGeo);
    // the system arrow renders above the annotation
    expect(preMesh.renderOrder).toBeGreaterThan(annotationGroup().children[0].renderOrder);

    // toggle: same endpoints + same color removes the annotation
    arrows.addArrow({ file: 4, rank: 1 }, { file: 4, rank: 3 }, '#4488ff');
    expect(annotationGroup().children).toHaveLength(0);
    expect(premoveGroup().children[0]).toBe(preMesh);

    // re-add with a different color: annotation replaced, premove untouched
    arrows.addArrow({ file: 4, rank: 1 }, { file: 4, rank: 3 }, '#ffdd00');
    expect(annotationGroup().children).toHaveLength(1);
    expect(premoveGroup().children[0]).toBe(preMesh);

    // clear all annotations
    arrows.clearArrows();
    expect(annotationGroup().children).toHaveLength(0);
    expect(premoveGroup().children).toHaveLength(1);
    expect(premoveGroup().children[0]).toBe(preMesh);
    expect(preMesh.geometry).toBe(preGeo);
    expect(preMesh.material).toBe(preMat);
  });

  it('clearing the premove removes only the system arrow (annotations untouched)', () => {
    arrows.addArrow({ file: 0, rank: 0 }, { file: 1, rank: 1 }, '#ffdd00');
    premove.setPremove(PRE);
    expect(annotationGroup().children).toHaveLength(1);
    expect(premoveGroup().children).toHaveLength(1);

    premove.clearPremove();

    expect(premoveGroup().children).toHaveLength(0);
    expect(annotationGroup().children).toHaveLength(1);
  });

  // ── Replace / restore / dispose ─────────────────────────

  it('replacing the premove disposes the old geometry/material and keeps exactly one arrow', () => {
    premove.setPremove(PRE);
    const mesh1 = premoveMesh();
    const geoSpy = vi.spyOn(mesh1.geometry, 'dispose');
    const matSpy = vi.spyOn(mesh1.material, 'dispose');

    premove.setPremove(KNIGHT);

    expect(premoveGroup().children).toHaveLength(1);
    const mesh2 = premoveMesh();
    expect(mesh2).not.toBe(mesh1);
    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);
    // the new arrow follows the new (bent) path
    expect(mesh2.userData.dashSegments[0][0].x).toBeCloseTo(-3.5, 6);
    expect(mesh2.userData.dashSegments[0][0].z).toBeCloseTo(3.5, 6);
  });

  it('clear then re-set (reconnect restore) re-creates exactly one arrow with fresh resources', () => {
    premove.setPremove(PRE);
    const mesh1 = premoveMesh();
    const geoSpy = vi.spyOn(mesh1.geometry, 'dispose');
    const matSpy = vi.spyOn(mesh1.material, 'dispose');

    premove.clearPremove();
    expect(premoveGroup().children).toHaveLength(0);
    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);

    premove.setPremove(PRE);
    expect(premoveGroup().children).toHaveLength(1);
    const mesh2 = premoveMesh();
    expect(mesh2).not.toBe(mesh1);
    expect(mesh2.geometry).not.toBe(mesh1.geometry);
    expect(mesh2.material).not.toBe(mesh1.material);
  });

  it('set/clear cycles dispose every geometry and material exactly once (no accumulation)', () => {
    const createdGeos = new Set();
    const createdMats = new Set();
    for (let cycle = 0; cycle < 3; cycle++) {
      premove.setPremove(PRE);
      const mesh = premoveMesh();
      expect(premoveGroup().children).toHaveLength(1);
      createdGeos.add(mesh.geometry);
      createdMats.add(mesh.material);
      const geoSpy = vi.spyOn(mesh.geometry, 'dispose');
      const matSpy = vi.spyOn(mesh.material, 'dispose');
      premove.clearPremove();
      expect(premoveGroup().children).toHaveLength(0);
      expect(geoSpy).toHaveBeenCalledTimes(1);
      expect(matSpy).toHaveBeenCalledTimes(1);
    }
    expect(createdGeos.size).toBe(3);
    expect(createdMats.size).toBe(3);
  });

  it('disposeArrows3D disposes the active premove arrow and detaches the groups', () => {
    premove.setPremove(PRE);
    const mesh = premoveMesh();
    const geoSpy = vi.spyOn(mesh.geometry, 'dispose');
    const matSpy = vi.spyOn(mesh.material, 'dispose');
    const group = premoveGroup();

    board.disposeArrows3D();

    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);
    // the premove group is emptied and detached from the scene
    expect(group.children).toHaveLength(0);
    expect(group.parent).toBeNull();
    expect(scene.children.find((c) => c.name === 'premoveArrowGroup')).toBeUndefined();
    expect(scene.children.find((c) => c.name === 'arrowGroup')).toBeUndefined();
    // double dispose is a no-op
    expect(() => board.disposeArrows3D()).not.toThrow();
  });

  it('a premove state change after disposeArrows3D creates nothing (no resurrection)', () => {
    premove.setPremove(PRE);
    const mesh = premoveMesh();
    const geosBefore = THREE.bufferGeometryInstances.length;
    const matsBefore = THREE.meshBasicMaterialInstances.length;

    board.disposeArrows3D();

    // later premove state changes must not resurrect groups or resources
    premove.setPremove(KNIGHT);
    premove.clearPremove();
    premove.setPremove(PRE);

    expect(scene.children.find((c) => c.name === 'premoveArrowGroup')).toBeUndefined();
    expect(scene.children.find((c) => c.name === 'arrowGroup')).toBeUndefined();
    expect(THREE.bufferGeometryInstances.length).toBe(geosBefore);
    expect(THREE.meshBasicMaterialInstances.length).toBe(matsBefore);
    // the disposed mesh is left untouched
    expect(mesh.geometry).toBeDefined();
    expect(mesh.material).toBeDefined();
  });

  it('re-init after dispose restores exactly one premove arrow with fresh resources', () => {
    premove.setPremove(PRE);
    const mesh1 = premoveMesh();
    const geoSpy = vi.spyOn(mesh1.geometry, 'dispose');
    const matSpy = vi.spyOn(mesh1.material, 'dispose');
    const geosBefore = THREE.bufferGeometryInstances.length;
    const matsBefore = THREE.meshBasicMaterialInstances.length;

    board.disposeArrows3D();
    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);

    const scene2 = new THREE.Scene();
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');
    board.initArrows3D(scene2, camera);
    expect(rafSpy).toHaveBeenCalled(); // width-update loop restarted
    rafSpy.mockRestore();

    // exactly one fresh arrow: one new geometry + one new material
    expect(THREE.bufferGeometryInstances.length).toBe(geosBefore + 1);
    expect(THREE.meshBasicMaterialInstances.length).toBe(matsBefore + 1);
    const group2 = scene2.children.find((c) => c.name === 'premoveArrowGroup');
    expect(group2.children).toHaveLength(1);
    const mesh2 = group2.children[0];
    expect(mesh2).not.toBe(mesh1);
    expect(mesh2.geometry).not.toBe(mesh1.geometry);
    expect(mesh2.material).not.toBe(mesh1.material);
    // no duplicate groups in the new scene; the old scene is fully cleaned up
    expect(scene2.children.filter((c) => c.name === 'premoveArrowGroup')).toHaveLength(1);
    expect(scene.children.find((c) => c.name === 'premoveArrowGroup')).toBeUndefined();
    expect(scene.children.find((c) => c.name === 'arrowGroup')).toBeUndefined();
    // width updates work on the re-created arrow (edges symmetric about
    // the centerline, anchored at the origin)
    camera.position.set(0, 10, 0);
    board.updateAllArrowWidths();
    const v = verts(mesh2);
    const hw = Math.abs(v(0)[0] - 0.5);
    expect(hw).toBeGreaterThan(0);
    expect(v(0)[2]).toBeCloseTo(2.5, 6);
    expect(v(1)[0]).toBeCloseTo(0.5 - hw, 6);
  });

  it('scene recreation (initArrows3D again) restores the pending premove arrow exactly once', () => {
    premove.setPremove(PRE);
    const mesh1 = premoveMesh();
    const oldGroup = premoveGroup();
    const geoSpy = vi.spyOn(mesh1.geometry, 'dispose');
    const matSpy = vi.spyOn(mesh1.material, 'dispose');

    const scene2 = new THREE.Scene();
    board.initArrows3D(scene2, camera);

    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);
    const group2 = scene2.children.find((c) => c.name === 'premoveArrowGroup');
    expect(group2.children).toHaveLength(1);
    expect(group2.children[0]).not.toBe(mesh1);
    // the old scene's group is emptied and detached
    expect(oldGroup.children).toHaveLength(0);
    expect(scene.children.find((c) => c.name === 'premoveArrowGroup')).toBeUndefined();
    // no duplicate group in the new scene
    expect(scene2.children.filter((c) => c.name === 'premoveArrowGroup')).toHaveLength(1);
  });
});
