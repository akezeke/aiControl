// A member's bubble, grown to say more: the hover's facts, drawn where the bubble was and following them about.
import { providerIcon } from '../provider-icons.js';
import { hpBand, hpOf, modelName, tokens } from './roster.js';

const el = (className, text) => { const node = document.createElement('div'); node.className = className; if (text != null) node.textContent = text; return node; };
const joined = parts => parts.filter(Boolean).join(' · ');

export function createSay(container, calm) {
  const node = el('fy-say'), panel = el('fy-say-in win'), tail = document.createElement('u');
  node.hidden = true; node.setAttribute('aria-hidden', 'true'); node.append(panel, tail); container.append(node);
  let id = null, signature = '', wide = 0, high = 0, grew = null;
  return {
    // `words` is what the bubble said; `size` the bubble's on-screen size, which is what it grows from.
    show(next, { words, facts, session, minions = 0 } = {}, size) {
      if (!next || !facts) { node.hidden = true; id = null; signature = ''; return; }
      const hp = hpOf(session?.context), step = session?.plan?.find(item => item.status === 'active')?.step, cost = session?.cost;
      const meta = joined([modelName(session?.model), session?.effort, facts.branch, facts.mode && `${facts.mode} mode`]);
      const plan = facts.plan ? joined([`${facts.plan[0]}/${facts.plan[1]} steps`, step]) : '';
      const foot = joined([facts.state, cost && Number.isFinite(cost.usd) && `$${cost.usd.toFixed(2)}`, cost && (cost.added || cost.removed) && `+${cost.added} −${cost.removed}`, minions && `${minions} subagent${minions > 1 ? 's' : ''}`]);
      const said = words || facts.title, detail = facts.detail && facts.detail !== said ? facts.detail : '';
      const now = JSON.stringify([next, said, detail, facts.title, meta, plan, foot, hp && [hp.left, hp.max]]);
      if (now === signature && !node.hidden) return;
      signature = now;
      const title = el('fy-say-title'); if (facts.provider) title.append(providerIcon(facts.provider)); title.append(document.createTextNode(facts.title || ''));
      const saying = el('fy-say-now', said); if (size?.tall) saying.style.fontSize = `${Math.max(18, size.tall * .452).toFixed(1)}px`; // As big as the bubble's own words, so it grows and doesn't shrink.
      const lines = [saying, said !== facts.title && title, detail && el('fy-say-detail', detail), meta && el('fy-say-meta', meta)];
      if (hp) { const bar = el(`fy-bar ${hpBand(hp.ratio)}`), track = document.createElement('u'), inner = document.createElement('b'), left = document.createElement('em'); inner.style.width = `${(hp.ratio * 100).toFixed(1)}%`; track.append(inner); left.textContent = `${tokens(hp.left)} left`; bar.append(document.createTextNode('Context'), track, left); lines.push(bar); }
      lines.push(plan && el('fy-say-meta', plan), foot && el('fy-say-foot', foot));
      panel.replaceChildren(...lines.filter(Boolean));
      node.hidden = false; wide = node.offsetWidth; high = node.offsetHeight;
      if (next !== id && !calm && size?.wide && wide && high) { grew?.cancel(); grew = panel.animate([{ transform: `scale(${Math.min(1, size.wide / wide).toFixed(3)}, ${Math.min(1, size.tall / high).toFixed(3)})` }, { transform: 'none' }], { duration: 130, easing: 'cubic-bezier(.2, .8, .3, 1)' }); }
      id = next;
    },
    // The tip of the tail on this point, with the window kept inside the bounds and the tail still pointing.
    place(x, y, right, top) {
      if (node.hidden) return;
      const left = Math.max(8, Math.min(right - wide - 8, x - wide / 2)), rise = Math.max(top, y - high - 9);
      node.style.transform = `translate(${left.toFixed(1)}px, ${rise.toFixed(1)}px)`;
      tail.style.left = `${Math.max(14, Math.min(wide - 14, x - left)).toFixed(1)}px`;
    },
    dispose() { grew?.cancel(); node.remove(); },
  };
}
