// A rare, decorative stowaway. CSS does all movement; no frame loop, pointer tracking or audio.
const creature = `<svg viewBox="0 0 96 60" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <g stroke="#78937c" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
    <path class="visitor-tail" d="M46 35C29 39 15 36 10 25S14 9 5 7C16 5 23 21 19 26S29 32 46 31" fill="#0c1711"/>
    <g class="visitor-far" fill="#0a130e">
      <path class="visitor-leg back" d="M44 32L32 41L35 51L24 54L25 56L40 54L39 43L54 36Z"/>
      <path class="visitor-arm back" d="M58 23L65 35L76 34L81 38L74 39L60 39L49 29Z"/>
    </g>
    <g class="visitor-body" fill="#111e16">
      <path d="M41 24L33 15L36 13L47 22M45 21L39 11L42 9L52 20M49 20L47 10L50 9L57 20"/>
      <path d="M57 17C66 21 62 29 56 33L46 40L37 34L42 25Z"/>
      <path d="M43 26L54 29M41 30L51 33M40 34L47 36" stroke="#a0b396" stroke-width=".8"/>
      <path d="M59 19L66 27L77 28L82 24L80 18Z"/>
      <path d="M69 25H78M71 23V26M74 23V26M77 23V26" stroke="#bac7aa" stroke-width=".9"/>
      <path d="M37 18C27 17 28 10 36 7C48 2 70 5 80 10C86 13 88 18 83 22L68 21L57 18Z"/>
      <path d="M34 12C44 5 65 7 76 11" stroke="#b1c2a5" stroke-opacity=".7"/>
      <path d="M35 16L57 16" stroke="#526b55"/>
    </g>
    <g fill="#101d15">
      <path class="visitor-leg front" d="M49 33C43 37 41 41 47 44L58 48L54 53L62 55L67 54L61 51L64 46L52 39L56 35Z"/>
      <path class="visitor-arm front" d="M59 24L67 34L65 43L72 47L76 46L69 41L73 32L65 22Z"/>
    </g>
  </g>
</svg>`;

let enabled = false, installed = false, visited = false, timer, visitor, stage, faultTimer;
const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
const editing = () => document.activeElement?.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
const allowed = () => enabled && !motion?.matches && !document.hidden && !editing();

function clear() {
  clearTimeout(timer); timer = undefined;
  stage?.remove(); stage = visitor = undefined;
}
function schedule(first = false) {
  if (!allowed()) return;
  timer = setTimeout(visit, first && !visited ? 14_000 + Math.random() * 14_000 : 45_000 + Math.random() * 50_000);
}
function finish() { clear(); schedule(); }
function visit() {
  timer = undefined;
  if (!allowed()) return;
  // Stay away from the lock screen and full-size screenshots.
  if (!document.querySelector('.shell') || document.querySelector('dialog[open]')) { schedule(); return; }
  visited = true;
  visitor = document.createElement('div'); visitor.className = 'alien-visitor';
  visitor.setAttribute('aria-hidden', 'true');
  visitor.dataset.kind = Math.random() < .6 ? 'peek' : 'run';
  visitor.dataset.direction = Math.random() < .5 ? 'left' : 'right';
  visitor.style.setProperty('--visitor-y', visitor.dataset.kind === 'peek' ? `${18 + Math.random() * 55}vh` : Math.random() < .5 ? '12vh' : 'calc(100dvh - 54px)');
  visitor.innerHTML = creature;
  visitor.addEventListener('animationend', event => { if (event.target === visitor) finish(); });
  // Clip the journey to the viewport so an off-screen visitor never creates a page scrollbar.
  stage = document.createElement('div'); stage.className = 'alien-visitor-stage'; stage.setAttribute('aria-hidden', 'true');
  stage.append(visitor); document.body.append(stage);
  timer = setTimeout(finish, 8000); // Cleanup also works if styles or animation events fail to load.
}
function sync() { clear(); schedule(true); }

function scheduleFault() {
  if (allowed()) faultTimer = setTimeout(fault, 22_000 + Math.random() * 33_000);
}
function fault() {
  faultTimer = undefined;
  if (!allowed()) return;
  if (!document.querySelector('.shell') || document.querySelector('dialog[open]')) { scheduleFault(); return; }
  const root = document.documentElement;
  root.style.setProperty('--crt-fault-y', `${8 + Math.random() * 80}vh`);
  root.style.setProperty('--crt-fault-height', Math.random() < .5 ? '3px' : '26px');
  root.setAttribute('data-crt-fault', '');
  faultTimer = setTimeout(() => { root.removeAttribute('data-crt-fault'); scheduleFault(); }, 450);
}
function syncAmbience() {
  sync();
  clearTimeout(faultTimer); faultTimer = undefined;
  document.documentElement.removeAttribute('data-crt-fault');
  scheduleFault();
}

export function setAlienAmbienceEnabled(value) {
  if (enabled === value) return;
  enabled = value;
  if (value && !installed) {
    installed = true;
    document.addEventListener('visibilitychange', syncAmbience);
    document.addEventListener('focusin', syncAmbience);
    document.addEventListener('focusout', syncAmbience);
    motion?.addEventListener('change', syncAmbience);
  }
  syncAmbience();
}
