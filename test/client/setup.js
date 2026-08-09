// Polyfill requestPointerLock on canvas elements for jsdom
HTMLCanvasElement.prototype.requestPointerLock = function () {};

// Suppress undici WebSocket Event class mismatch errors in Node.js 24.
// undici's Event class doesn't match Node's native Event, causing
// "The event argument must be an instance of Event" when dispatching
// WebSocket events. These are harmless in tests — the WebSocket
// connection fails anyway (no server), and the tests don't depend on it.
// Guard against duplicate registration (setup files run per test file).
if (!globalThis.__mpchess_vitest_handlers_installed) {
  globalThis.__mpchess_vitest_handlers_installed = true;

  process.on('uncaughtException', (err) => {
    if (
      err instanceof TypeError &&
      err.code === 'ERR_INVALID_ARG_TYPE' &&
      err.message.includes('The "event" argument must be an instance of Event')
    ) {
      return; // suppress
    }
    throw err;
  });

  process.on('unhandledRejection', (reason) => {
    if (
      reason instanceof TypeError &&
      reason.code === 'ERR_INVALID_ARG_TYPE' &&
      reason.message.includes('The "event" argument must be an instance of Event')
    ) {
      return; // suppress
    }
    throw reason;
  });
}
