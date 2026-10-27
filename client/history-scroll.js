// Follow a chat only while the reader is at its end. Keep a visible message
// anchored when a rolling history removes older entries above the viewport.
export class HistoryScroll {
  constructor(viewport, latestButton) {
    this.viewport = viewport;
    this.latestButton = latestButton;
    this.following = true;
    this.lastTop = 0;
    // Only scrolling up leaves the end. The scroll event of a jump can arrive after late content
    // (fonts, layout) has grown the history, which would otherwise stop following just short of the end.
    this.onScroll = () => {
      const top = viewport.scrollTop;
      if (this.atBottom()) this.following = true; else if (top < this.lastTop) this.following = false;
      this.lastTop = top;
      this.updateButton();
    };
    this.onLatest = () => { this.jumpToLatest(); viewport.focus({ preventScroll: true }); };
    this.onClick = event => {
      const summary = event.target.closest?.('summary');
      if (summary?.parentElement?.tagName === 'DETAILS' && !summary.parentElement.open) {
        this.following = false;
        this.updateButton();
      }
    };
    this.onToggle = event => {
      if (event.target.tagName === 'DETAILS' && event.target.open) {
        this.following = false;
        this.updateButton();
      }
    };
    viewport.addEventListener('scroll', this.onScroll, { passive: true });
    viewport.addEventListener('click', this.onClick);
    viewport.addEventListener('toggle', this.onToggle, true);
    latestButton.addEventListener('click', this.onLatest);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resized());
      this.observer.observe(viewport);
      if (viewport.firstElementChild) this.observer.observe(viewport.firstElementChild);
    }
    this.updateButton();
  }
  atBottom() { return this.viewport.scrollHeight - this.viewport.clientHeight - this.viewport.scrollTop <= 32; }
  updateButton() { this.latestButton.hidden = this.following || this.atBottom(); }
  jumpToLatest() {
    this.following = true;
    this.viewport.scrollTop = this.viewport.scrollHeight;
    this.lastTop = this.viewport.scrollTop;
    this.updateButton();
  }
  resized() { if (this.following) this.jumpToLatest(); else this.updateButton(); }
  capture() {
    const top = this.viewport.getBoundingClientRect().top;
    const anchors = [...this.viewport.querySelectorAll('[data-message-id]')].map(node => {
      const rect = node.getBoundingClientRect();
      return { id: node.dataset.messageId, offset: rect.top - top, bottom: rect.bottom - top };
    }).filter(anchor => anchor.bottom > 0);
    return { following: this.following, scrollTop: this.viewport.scrollTop, anchors };
  }
  restore(saved) {
    if (saved.following) { this.jumpToLatest(); return; }
    this.following = false;
    const nodes = [...this.viewport.querySelectorAll('[data-message-id]')];
    const anchor = saved.anchors.find(item => nodes.some(node => node.dataset.messageId === item.id));
    if (anchor) {
      const node = nodes.find(item => item.dataset.messageId === anchor.id);
      this.viewport.scrollTop += node.getBoundingClientRect().top - this.viewport.getBoundingClientRect().top - anchor.offset;
    } else this.viewport.scrollTop = saved.scrollTop;
    this.lastTop = this.viewport.scrollTop;
    this.updateButton();
  }
  destroy() {
    this.observer?.disconnect();
    this.viewport.removeEventListener('scroll', this.onScroll);
    this.viewport.removeEventListener('click', this.onClick);
    this.viewport.removeEventListener('toggle', this.onToggle, true);
    this.latestButton.removeEventListener('click', this.onLatest);
  }
}
