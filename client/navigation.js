export class PanelNavigation {
  constructor(browser, onChange) {
    this.browser = browser; this.onChange = onChange;
    browser.addEventListener('popstate', () => this.sync());
    browser.addEventListener('hashchange', () => this.sync());
  }
  selected() { return new URLSearchParams(this.browser.location.hash.slice(1)).get('session'); }
  sync() { this.onChange(this.selected()); }
  open(id) {
    if (this.selected() !== id) {
      const { pathname, search } = this.browser.location;
      this.browser.history.pushState({ aiControlPanel: true }, '', `${pathname}${search}#${new URLSearchParams({ session: id })}`);
    }
    this.onChange(id);
  }
  close() {
    if (this.browser.history.state?.aiControlPanel) this.browser.history.back();
    else this.reset();
    this.onChange(null);
  }
  reset() {
    const { pathname, search } = this.browser.location;
    this.browser.history.replaceState(null, '', pathname + search);
  }
}
