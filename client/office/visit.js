// Going to the meeting: your front door takes you to the host's office and theirs brings you back (office.js does what the
// steps say). Pure, so node can run it. The hub sends the host's floor only to whoever says they're at the meeting, so the
// door first asks (`ask`: say so, and wait a moment); the fade starts once the floor's come, and none came means nobody's
// there: back to saying you're home, never moved. A fade begun is always undone, whatever reduced motion says by then.
//   then: ask, fadeOut, build (draw the host's floor, again on each new one), place (inside the door), fadeIn,
//         goHome (say you're home, draw your own office), nobody (the door's card says so).
export const FADE_MS = 350, WAIT_MS = 3000;

const to = (at, then, extra = {}) => ({ at, ...extra, then });
// `state`: { at: home | leaving | away | returning, fading (leaving: the fade out's begun) }.
// `event`: { type: door | floor | floorGone | left | faded, reduced }.
export function visitStep(state, { type, reduced = false }) {
  const gone = type === 'floorGone' || type === 'left';
  switch (state.at) {
    case 'home':
      if (type === 'door') return to('leaving', ['ask']);
      break;
    case 'leaving':
      if (type === 'floor' && !state.fading) return reduced ? to('away', ['build', 'place']) : to('leaving', ['fadeOut'], { fading: true });
      if (type === 'faded' && state.fading) return to('away', ['build', 'place', 'fadeIn']);
      if (gone) return to('home', ['goHome', ...state.fading ? ['fadeIn'] : [], ...type === 'floorGone' ? ['nobody'] : []]);
      break;
    case 'away':
      if (type === 'floor') return to('away', ['build']);
      if (type === 'door' || gone) return reduced ? to('home', ['goHome', 'place']) : to('returning', ['fadeOut']);
      break;
    case 'returning':
      if (type === 'faded') return to('home', ['goHome', 'place', 'fadeIn']);
      break;
  }
  return { ...state, then: [] };
}

// The host's machine as the meetings clipboard writes it: its first label, or a whole IP address.
export const hostName = host => /^\d+(\.\d+){3}$/.test(host) ? host : String(host).split('.')[0];

// The door's one-row card: { text, go } (go: whether choosing it does anything), or null for none. `host`: hostName's.
// `hosting`: this page's office is the meeting. `nobody`: the last ask found no one there.
export function doorCard(at, { joined, host, hosting, nobody }) {
  if (at === 'away') return { text: 'Back to your office', go: true };
  if (!joined || hosting || (at !== 'home' && at !== 'leaving')) return null;
  if (at === 'leaving') return { text: `Meeting at ${host}`, go: false };
  return nobody ? { text: `Nobody's at ${host}'s office`, go: false } : { text: `Meeting at ${host}`, go: true };
}
