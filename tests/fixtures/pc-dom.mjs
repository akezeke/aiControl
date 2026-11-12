// A small fake DOM for the boss PC's tests (no jsdom): elements with a tree, classList, capture/bubble events (once, dedupe),
// focus and a recording 2d canvas. Only what the desktop's modules touch; add here rather than in a test file.
// NOT modelled:
// - attribute/property links: setAttribute('class') vs classList/className, node.src vs attributes.src, value vs attribute;
// - textContent neither clears nor aggregates children (it is a plain field);
// - style is a plain object (no cssText, no shorthand expansion);
// - focus() works on removed or hidden nodes, and blur() fires no events;
// - no stopImmediatePropagation, no passive/signal options, no event.bubbles = false;
// - canvas: save()/restore() don't restore recorded state, and there is no measureText.
const mixin = (node) => {
  const listeners = new Map(); // type -> [{ fn, capture, once }]
  const capture = options => typeof options === 'boolean' ? options : !!options?.capture;
  node.addEventListener = (type, fn, options) => {
    const list = listeners.get(type) ?? listeners.set(type, []).get(type), cap = capture(options);
    if (!list.some(l => l.fn === fn && l.capture === cap)) list.push({ fn, capture: cap, once: !!options?.once });
  };
  node.removeEventListener = (type, fn, options) => {
    const list = listeners.get(type), i = list ? list.findIndex(l => l.fn === fn && l.capture === capture(options)) : -1;
    if (i >= 0) list.splice(i, 1);
  };
  node.listenerCount = () => [...listeners.values()].reduce((n, list) => n + list.length, 0);
  // phase: 'capture' (capturing listeners only), 'bubble' (the others) or 'target' (all).
  node.fire = (event, phase = 'target') => {
    for (const l of [...(listeners.get(event.type) ?? [])]) {
      if (phase !== 'target' && l.capture !== (phase === 'capture')) continue;
      if (l.once) node.removeEventListener(event.type, l.fn, l.capture);
      l.fn.call(node, event);
    }
  };
};

// Records every call with a snapshot of the settable properties at that moment (fillStyle, imageSmoothingEnabled, ...).
function context2d() {
  const props = {}, calls = [];
  return new Proxy({ calls, props }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key in props) return props[key];
      return (...args) => { calls.push({ name: key, args, state: { ...props } }); };
    },
    set(target, key, value) { props[key] = value; return true; },
  });
}

export function useDom(t) {
  const was = globalThis.document;
  const doc = { activeElement: null, parent: null, children: [] };
  mixin(doc);
  function element(tag) {
    const classes = new Set();
    const node = {
      tag, parent: null, children: [], attributes: {}, style: {}, dataset: {}, hidden: false, textContent: '', value: '', type: '',
      classList: {
        add: (...names) => { for (const n of names) classes.add(n); },
        remove: (...names) => { for (const n of names) classes.delete(n); },
        toggle: (name, force) => { const on = force ?? !classes.has(name); if (on) classes.add(name); else classes.delete(name); return on; },
        contains: name => classes.has(name),
      },
      get className() { return [...classes].join(' '); },
      set className(value) { classes.clear(); for (const n of String(value).split(/\s+/)) if (n) classes.add(n); },
      setAttribute(name, value) { node.attributes[name] = String(value); },
      getAttribute: name => node.attributes[name] ?? null,
      hasAttribute: name => name in node.attributes,
      removeAttribute(name) { delete node.attributes[name]; },
      dispatch(type, init = {}) {
        const event = {
          type, target: node, currentTarget: null, defaultPrevented: false, propagationStopped: false, ...init,
          preventDefault() { event.defaultPrevented = true; }, stopPropagation() { event.propagationStopped = true; },
        };
        const path = []; for (let at = node.parent; at; at = at.parent) path.push(at);
        const visit = (at, phase) => { if (!event.propagationStopped) { event.currentTarget = at; at.fire(event, phase); } };
        for (const at of [...path].reverse()) visit(at, 'capture');
        visit(node, 'target');
        for (const at of path) visit(at, 'bubble');
        return event;
      },
      focus() { doc.activeElement = node; },
      blur() { if (doc.activeElement === node) doc.activeElement = null; },
      append(...kids) {
        for (const kid of kids) {
          const child = typeof kid === 'object' ? kid : Object.assign(element('#text'), { textContent: String(kid) });
          child.remove(); child.parent = node; node.children.push(child);
        }
      },
      appendChild(kid) { node.append(kid); return kid; },
      remove() { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
      replaceChildren(...kids) { for (const kid of node.children) kid.parent = null; node.children = []; node.append(...kids); },
      contains: other => other === node || node.children.some(kid => kid.contains(other)),
      querySelectorAll: test => findAll(node, test).filter(n => n !== node),
      closest(test) { for (let at = node; at && at.tag; at = at.parent) if (test(at)) return at; return null; },
    };
    mixin(node);
    if (tag === 'canvas') {
      let g = null; node.width = 300; node.height = 150;
      node.getContext = () => g ??= context2d();
      node.toDataURL = () => 'data:image/png;base64,';
    }
    return node;
  }
  doc.createElement = element; doc.createElementNS = (_, tag) => element(tag);
  doc.body = element('body'); doc.body.parent = doc; doc.children.push(doc.body);
  // Events that bubble past <body> reach the document, as in a browser.
  globalThis.document = doc;
  t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; });
  return doc;
}

export function findAll(root, test) {
  const out = []; (function walk(n) { if (test(n)) out.push(n); for (const kid of n.children) walk(kid); })(root); return out;
}
export const find = (root, test) => findAll(root, test)[0];
