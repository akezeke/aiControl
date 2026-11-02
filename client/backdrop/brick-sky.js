// The wallpaper of Brick Knights is a still photograph; this is the sky over it: a dragon crosses now and then.
// A transform in CSS (see bricks.css), nothing to run in JS and nothing kept once another theme is picked.
// It sits behind the interface and takes no input.
let sky;
export function setBrickSky(on) {
  if (!on) { sky?.remove(); sky = undefined; return; }
  if (sky?.isConnected) return;
  sky = document.createElement('div'); sky.id = 'brick-sky'; sky.setAttribute('aria-hidden', 'true');
  const dragon = document.createElement('i'); dragon.className = 'sky-dragon'; dragon.append(document.createElement('b')); sky.append(dragon);
  document.body.prepend(sky);
}
