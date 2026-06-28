// Mock for Three.js — provides just enough for client-side unit tests

export class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
}

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  setY(y) { this.y = y; return this; }
  normalize() { return this; }
  crossVectors(a, b) { this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}

export class Euler {
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') { this.x = x; this.y = y; this.z = z; this.order = order; }
  set(x, y, z, order) { this.x = x; this.y = y; this.z = z; this.order = order; }
  setFromQuaternion(q) {
    this.x = Math.asin(2 * (q.w * q.y - q.z * q.x));
    this.y = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
    this.z = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
  }
}

export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  setFromEuler(e) {
    const c1 = Math.cos(e.x / 2), c2 = Math.cos(e.y / 2), c3 = Math.cos(e.z / 2);
    const s1 = Math.sin(e.x / 2), s2 = Math.sin(e.y / 2), s3 = Math.sin(e.z / 2);
    this.w = c1 * c2 * c3 + s1 * s2 * s3;
    this.x = s1 * c2 * c3 - c1 * s2 * s3;
    this.y = c1 * s2 * c3 + s1 * c2 * s3;
    this.z = c1 * c2 * s3 - s1 * s2 * c3;
  }
}

export class Raycaster {
  constructor() { this._intersectFn = null; }
  setFromCamera() {}
  intersectObjects() { return this._intersectFn ? this._intersectFn() : []; }
  setIntersectResult(fn) { this._intersectFn = fn; }
}

export class PerspectiveCamera {
  constructor() { this.position = new Vector3(); this.quaternion = new Quaternion(); }
  lookAt() {}
  getWorldDirection(v) { v.x = 0; v.y = 0; v.z = -1; }
}

export class Scene {
  constructor() { this.children = []; }
  add(obj) { this.children.push(obj); }
}

export class WebGLRenderer {
  constructor() {
    this.domElement = document.createElement('canvas');
    this.domElement.requestPointerLock = () => {};
  }
  render() {}
}

export class PlaneGeometry {}
export class BoxGeometry {}

export class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry; this.material = material;
    this.position = new Vector3(); this.rotation = new Euler();
  }
}

export class Color {
  constructor(hex = 0xffffff) { this.r = ((hex >> 16) & 255) / 255; this.g = ((hex >> 8) & 255) / 255; this.b = (hex & 255) / 255; }
  set(hex) { this.r = ((hex >> 16) & 255) / 255; this.g = ((hex >> 8) & 255) / 255; this.b = (hex & 255) / 255; return this; }
  copy(other) { this.r = other.r; this.g = other.g; this.b = other.b; return this; }
}

export class MeshStandardMaterial {
  constructor(opts = {}) {
    this.color = opts.color ? new Color(opts.color) : new Color(0xffffff);
    this.emissive = opts.emissive || new Color(0x000000);
    this.emissiveIntensity = opts.emissiveIntensity || 0;
    this.roughness = opts.roughness ?? 1;
    this.metalness = opts.metalness ?? 0;
  }
  clone() { return new MeshStandardMaterial(this); }
  copy(other) { this.color = other.color; this.emissive = other.emissive; this.emissiveIntensity = other.emissiveIntensity; }
}

export class AmbientLight { constructor(color, intensity) { this.color = color; this.intensity = intensity; } }
export class HemisphereLight { constructor(sky, ground, intensity) { this.skyColor = sky; this.groundColor = ground; this.intensity = intensity; } }
export class DirectionalLight {
  constructor(color, intensity) {
    this.color = color; this.intensity = intensity;
    this.position = new Vector3(); this.castShadow = false;
    this.shadow = { mapSize: {}, camera: { left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0 }, bias: 0 };
  }
}
export class FogExp2 { constructor(color, density) { this.color = color; this.density = density; } }
