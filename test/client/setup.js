// Polyfill requestPointerLock on canvas elements for jsdom
HTMLCanvasElement.prototype.requestPointerLock = function () {};
