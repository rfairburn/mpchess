// ═══════════════════════════════════════════════════════════
//  APP — Three.js scene, camera, renderer, materials, animation loop
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';

import { onMove } from './network.js';
import { updateMouseModeDisplay } from './ui.js';
import { createBoard, setMaterials as setBoardMaterials, createLabels } from './board.js';
import { setMaterials as setPieceMaterials, loadPieceModels, animations, setScene, animateMove } from './pieces.js';
import { setRenderer, setClickHandler, keys, yaw, pitch, mouseLookOn } from './controls.js';

// ── Materials ────────────────────────────────────────────

const matWhite = new THREE.MeshStandardMaterial({
  color: 0xf0e6d0, roughness: 0.35, metalness: 0.04
});
const matBlack = new THREE.MeshStandardMaterial({
  color: 0x3d2b1f, roughness: 0.30, metalness: 0.05
});
const matLight = new THREE.MeshStandardMaterial({
  color: 0xf0d9b5, roughness: 0.70
});
const matDark = new THREE.MeshStandardMaterial({
  color: 0xb58863, roughness: 0.70
});
const matBorder = new THREE.MeshStandardMaterial({
  color: 0x5c3a1e, roughness: 0.60
});
const matSelected = new THREE.MeshStandardMaterial({
  color: 0xf0d9b5, roughness: 0.70,
  emissive: new THREE.Color(0x88aa00), emissiveIntensity: 0.6
});
const matValidMove = new THREE.MeshStandardMaterial({
  color: 0xf0d9b5, roughness: 0.70,
  emissive: new THREE.Color(0x44bb44), emissiveIntensity: 0.5
});
const matCaptureMove = new THREE.MeshStandardMaterial({
  color: 0xb58863, roughness: 0.70,
  emissive: new THREE.Color(0xcc3333), emissiveIntensity: 0.5
});
const matCheck = new THREE.MeshStandardMaterial({
  color: 0xb58863, roughness: 0.70,
  emissive: new THREE.Color(0xff0000), emissiveIntensity: 0.8
});

// Share materials with other modules
setBoardMaterials(matLight, matDark, matSelected, matValidMove, matCaptureMove, matCheck);
setPieceMaterials(matWhite, matBlack);

// ── Scene / Camera / Renderer ────────────────────────────

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1410);
scene.fog = new THREE.FogExp2(0x1a1410, 0.035);

const camera = new THREE.PerspectiveCamera(
  50, window.innerWidth / window.innerHeight, 0.1, 100
);
camera.position.set(-10, 7, 0);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

// Lighting
scene.add(new THREE.AmbientLight(0xffeedd, 0.35));
const hemi = new THREE.HemisphereLight(0x87ceeb, 0x8b7355, 0.30);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xfff4e0, 1.0);
keyLight.position.set(6, 14, 4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -8;
keyLight.shadow.camera.right = 8;
keyLight.shadow.camera.top = 8;
keyLight.shadow.camera.bottom = -8;
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 30;
keyLight.shadow.bias = -0.0005;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xc8d8f0, 0.30);
fillLight.position.set(-5, 8, -3);
scene.add(fillLight);

// ── Wire up modules ──────────────────────────────────────

setRenderer(renderer, camera);
setClickHandler(renderer);
setScene(scene);

// ── Build scene ──────────────────────────────────────────

createBoard(scene, matBorder);
updateMouseModeDisplay(mouseLookOn);

loadPieceModels(scene, () => {
  // Pieces will be built when server sends state
  const loader = new FontLoader();
  loader.load(
    'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/fonts/helvetiker_regular.typeface.json',
    (font) => createLabels(scene, font)
  );
});

// ── Move animation handler ───────────────────────────────

onMove((msg) => {
  animateMove(scene, msg.fromFile, msg.fromRank, msg.toFile, msg.toRank, msg.castled, msg.enPassant, msg.captured);
});

// ── Animation loop ───────────────────────────────────────

const clock = new THREE.Clock();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _camFwd = new THREE.Vector3();
const _camFwdH = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3(0, 1, 0);

(function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (mouseLookOn) {
    euler.set(pitch, yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);
    camera.getWorldDirection(_camFwd);
    _camFwdH.copy(_camFwd).setY(0).normalize();
    _camRight.crossVectors(_camFwdH, _camUp).normalize();
    const speed = 8 * dt;
    if (keys.KeyW) camera.position.addScaledVector(_camFwdH, speed);
    if (keys.KeyS) camera.position.addScaledVector(_camFwdH, -speed);
    if (keys.KeyA) camera.position.addScaledVector(_camRight, -speed);
    if (keys.KeyD) camera.position.addScaledVector(_camRight, speed);
    if (keys.KeyQ) camera.position.y += speed;
    if (keys.KeyE) camera.position.y -= speed;
  }

  // Update piece animations
  const now = performance.now();
  for (let i = animations.length - 1; i >= 0; i--) {
    if (animations[i].update(now)) {
      animations.splice(i, 1);
    }
  }

  renderer.render(scene, camera);
})();

// ── Resize ───────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
