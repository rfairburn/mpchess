// Mock TextGeometry for client-side unit tests
export class TextGeometry {
  constructor() {
    this.boundingBox = {
      getCenter: (target) => {
        target.x = 0.05;
        target.y = 0.05;
        target.z = 0;
        return target;
      },
    };
  }
  computeBoundingBox() {
    return this.boundingBox;
  }
  translate(x, y, z) {
    this._tx = x;
    this._ty = y;
    this._tz = z;
    return this;
  }
}
