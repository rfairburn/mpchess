// Mock for Three.js FontLoader

export class FontLoader {
  load(url, callback) {
    // Simulate synchronous load with a dummy font
    if (callback) {
      callback({
        generateShapes: () => [],
      });
    }
  }
}
