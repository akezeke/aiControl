// Coalesce live refreshes until a brief pause in typing, with a bounded delay
// so status changes and permission requests still appear during long edits.
export class LiveRender {
  constructor(render, {
    quietMs = 180, maxWaitMs = 1000, now = Date.now,
    // Browser timers require the global receiver, even when stored on a helper.
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = timer => globalThis.clearTimeout(timer),
  } = {}) {
    Object.assign(this, { render, quietMs, maxWaitMs, now, setTimer, clearTimer });
    this.quietUntil = 0;
    this.pendingSince = null;
  }
  interact() {
    this.quietUntil = this.now() + this.quietMs;
    if (this.pendingSince != null) this.schedule();
  }
  request() {
    this.pendingSince ??= this.now();
    this.schedule();
  }
  schedule() {
    if (this.timer != null) this.clearTimer(this.timer);
    const now = this.now(), delay = Math.max(0, Math.min(this.quietUntil - now, this.maxWaitMs - (now - this.pendingSince)));
    // Even at the deadline, yield out of the input event before touching DOM.
    this.timer = this.setTimer(() => { this.cancel(); this.render(); }, delay);
  }
  cancel() {
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null; this.pendingSince = null;
  }
}
