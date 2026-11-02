// Deals an Endless hole off the page's thread (surveying one can take seconds): golf.js posts { index, seed } and gets the hole.
import { endless } from './golf-course.js';

onmessage = ({ data: { index, seed } }) => {
  const run = endless(index, seed);
  for (;;) { const s = run.next(); if (s.done) { postMessage(s.value); return; } }
};
