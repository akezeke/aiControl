// A tool line into the move it looks like; the real line stays beside the move's name. Pure, the effects themselves are in fx.js.
import { fnv } from './roster.js';

export const MOVES = {
  scan: { name: 'Scan', color: 0x9fe0c0, dur: .85, cast: true },
  seek: { name: 'Seek', color: 0xb7d96a, dur: .75, cast: true },
  cut: { name: 'Cut', color: 0xf3ead2, dur: 1.1, melee: true, hit: true },
  forge: { name: 'Forge', color: 0xff9a3c, dur: 1.15, cast: true, hit: true },
  trial: { name: 'Trial', color: 0xffe066, dur: 1.05, cast: true, hit: true },
  seal: { name: 'Seal', color: 0xe0b040, dur: 1, cast: true, hit: true },
  launch: { name: 'Launch', color: 0xff6a3d, dur: 1.05, cast: true, hit: true },
  supply: { name: 'Supply', color: 0xa8e06a, dur: .85, cast: true },
  strike: { name: 'Strike', color: 0xffffff, dur: 1, melee: true, hit: true },
  sight: { name: 'Far Sight', color: 0x56c2a6, dur: 1.05, cast: true, hit: true },
  summon: { name: 'Summon', color: 0xe0603a, dur: 1.5, cast: true },
  skill: { name: 'Skill', color: 0xffffff, dur: 2.4, cast: true, hit: true, big: true },
};
const SPELL_COLOURS = [0xff7a3d, 0xffc738, 0x6fe39a, 0x56c2a6, 0xe0503a, 0xd8e05a, 0xf3ead2];
const titled = text => text.replace(/[-_:]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const shellMove = text => /\b(test|vitest|jest|pytest)\b/.test(text) ? 'trial' : /git commit/.test(text) ? 'seal' : /git push/.test(text) ? 'launch' : /\b(install|build)\b/.test(text) ? 'supply' : 'strike';

// A sage doesn't walk up to anyone and a gunner shoots: what's a blade for the others leaves their hands as a spell or a burst.
// What a bubble says: the tool alone on a small tile; tool and what it's on when there's room, a path shortened to its last part.
export function actionWords(line, wide) {
  const [tool, ...rest] = String(line || '').split(' · '), clip = (text, most) => text.length > most ? `${text.slice(0, most - 1)}…` : text;
  if (!wide) return clip(tool, 14);
  if (!rest.length) return clip(tool, 26);
  const what = rest.join(' · ');
  return clip(`${tool} · ${/\s/.test(what) ? what : what.split(/[\\/]/).filter(Boolean).pop() || what}`, 26);
}
export function deliver(ability, cls) {
  if (!ability.melee) return ability;
  if (cls === 'sage') return { ...ability, melee: false, cast: true, ranged: true };
  if (cls === 'gunner') return { ...ability, melee: false, shot: true };
  return ability;
}

export function abilityOf(line = '') {
  const [tool, ...rest] = line.split(' · '), label = rest.join(' · ');
  const known = (key, extra) => ({ key, ...MOVES[key], line, ...extra });
  if (/^(Bash|Shell)\b/.test(tool)) return known(shellMove(label));
  if (/^(Edit|MultiEdit|NotebookEdit|apply_patch)$/.test(tool)) return known('cut');
  if (tool === 'Write') return known('forge');
  if (tool === 'Read') return known('scan');
  if (/^Web/.test(tool)) return known('sight');
  if (/Grep|Glob|Search/.test(tool)) return known('seek');
  if (/^(Agent|Task)$/.test(tool)) return known('summon', { name: label ? `Summon ${titled(label)}` : 'Summon', summon: true });
  if (tool === 'Skill') return known('skill', { name: label ? titled(label) : 'Skill', color: SPELL_COLOURS[fnv(label) % SPELL_COLOURS.length] });
  return known(rest.length ? 'strike' : shellMove(line));
}
