// Lightweight event emitter — replaces 25+ callback arrays in network.js
export class EventEmitter {
  constructor() {
    this._events = {};
  }

  on(event, fn) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(fn);
  }

  emit(event, data) {
    const fns = this._events[event];
    if (fns) {
      for (const fn of fns) fn(data);
    }
  }
}
