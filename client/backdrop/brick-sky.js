// The wallpaper is a still photograph. Its small effects share its image coordinates and disappear with the theme.
// It sits behind the interface and takes no input.
let sky;
export function setBrickSky(on) {
  if (!on) { sky?.remove(); sky = undefined; return; }
  if (sky?.isConnected) return;
  sky = document.createElement('div'); sky.id = 'brick-sky'; sky.setAttribute('aria-hidden', 'true');
  const scene = document.createElement('div'); scene.className = 'castle-scene';
  const water = document.createElement('div'); water.className = 'castle-water'; scene.append(water);
  for (const [x, y, size] of [[833, 516, 44], [914, 516, 44], [1020, 388, 36], [1162, 420, 36], [1099, 719, 60], [1269, 695, 54], [1307, 676, 48], [1398, 741, 64]]) {
    const light = document.createElement('span'); light.className = 'castle-light';
    light.setAttribute('style', `--x:${x / 1536 * 100}%;--y:${y / 1024 * 100}%;--size:${size / 1536 * 100}%;--delay:-${x % 7 * .23}s`);
    scene.append(light);
  }
  const dragon = document.createElement('i'); dragon.className = 'sky-dragon'; dragon.append(document.createElement('b')); sky.append(dragon);
  sky.append(scene);
  document.body.prepend(sky);
}
