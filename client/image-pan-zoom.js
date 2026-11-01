const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Transform only the picture: the viewport clips it and the controls stay outside.
export class ImagePanZoom {
  constructor(viewport, picture, swipe = () => {}) {
    this.viewport = viewport; this.picture = picture; this.swipe = swipe;
    this.scale = 1; this.x = 0; this.y = 0; this.pointers = new Map(); this.listeners = [];
    const on = (node, type, handler, options) => {
      node.addEventListener(type, handler, options);
      this.listeners.push(() => node.removeEventListener(type, handler, options));
    };
    on(viewport, 'pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      viewport.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, this.point(event));
      if (this.pointers.size === 1) this.pinched = false;
      else this.pinched = true;
      this.rebase();
    });
    on(viewport, 'pointermove', event => this.move(event));
    const release = event => {
      if (!this.pointers.has(event.pointerId)) return;
      const start = this.gesture, end = this.point(event);
      if (event.type === 'pointerup') this.move(event);
      const swipe = event.type === 'pointerup' && event.pointerType !== 'mouse' && !this.pinched && this.pointers.size === 1 && start.scale === 1;
      this.pointers.delete(event.pointerId);
      this.rebase();
      if (swipe && Math.abs(end.x - start.center.x) > 40 && Math.abs(end.x - start.center.x) > Math.abs(end.y - start.center.y)) this.swipe(end.x < start.center.x ? 1 : -1);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(viewport, type, release);
    on(viewport, 'wheel', event => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      this.zoom(this.scale * Math.exp(-event.deltaY * unit * .002), this.point(event));
    }, { passive: false });
    on(viewport, 'dblclick', event => { event.preventDefault(); this.zoom(this.scale === 1 ? 2 : 1, this.point(event)); });
    on(picture, 'load', () => this.reset());
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => { this.render(); this.rebase(); });
      this.observer.observe(viewport);
      this.observer.observe(picture);
    }
  }
  point(event) {
    const box = this.viewport.getBoundingClientRect();
    return { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 };
  }
  measure() {
    const [a, b] = this.pointers.values();
    return b ? { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) } : { center: a, distance: 0 };
  }
  rebase() { this.gesture = { ...this.measure(), scale: this.scale, x: this.x, y: this.y }; }
  move(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, this.point(event));
    const start = this.gesture, current = this.measure();
    this.scale = clamp(start.distance ? start.scale * current.distance / start.distance : start.scale, 1, 8);
    const ratio = this.scale / start.scale;
    this.x = current.center.x - (start.center.x - start.x) * ratio;
    this.y = current.center.y - (start.center.y - start.y) * ratio;
    this.render();
  }
  zoom(scale, anchor = { x: 0, y: 0 }) {
    const next = clamp(scale, 1, 8), ratio = next / this.scale;
    this.x = anchor.x - (anchor.x - this.x) * ratio;
    this.y = anchor.y - (anchor.y - this.y) * ratio;
    this.scale = next; this.render(); this.rebase();
  }
  render() {
    const maxX = Math.max(0, (this.picture.offsetWidth * this.scale - this.viewport.clientWidth) / 2);
    const maxY = Math.max(0, (this.picture.offsetHeight * this.scale - this.viewport.clientHeight) / 2);
    this.x = clamp(this.x, -maxX, maxX); this.y = clamp(this.y, -maxY, maxY);
    this.picture.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
  }
  reset() { this.scale = 1; this.x = 0; this.y = 0; this.pointers.clear(); this.render(); this.rebase(); }
  destroy() { this.observer?.disconnect(); for (const remove of this.listeners) remove(); this.pointers.clear(); }
}
