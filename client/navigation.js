export class PanelNavigation {
  constructor(browser, onChange) {
    this.browser = browser; this.onChange = onChange;
    browser.addEventListener('popstate', () => this.sync());
    browser.addEventListener('hashchange', () => this.sync());
  }
  selected() { return new URLSearchParams(this.browser.location.hash.slice(1)).get('session'); }
  sync() { this.onChange(this.selected()); }
  // `replace` swaps the open panel for another, so Back still returns to the overview.
  open(id, { replace = false } = {}) {
    if (this.selected() !== id) {
      const { pathname, search } = this.browser.location, url = `${pathname}${search}#${new URLSearchParams({ session: id })}`;
      if (replace && this.browser.history.state?.aiControlPanel) this.browser.history.replaceState({ aiControlPanel: true }, '', url);
      else this.browser.history.pushState({ aiControlPanel: true }, '', url);
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
