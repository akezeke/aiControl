// Where the sun is for the themes that show the time of day (the office's windows, the city's ground), seen from the
// server's location (snapshot.location, server/config.mjs), or Stockholm until it says or when it can't tell.
const STOCKHOLM = [59.3333, 18.05];
let place = null;

// The sun's elevation in degrees at `time` (ms) seen from [lat, lon], and whether it is still climbing: the almanac's
// low-precision formulas, within a minute or two of the real sunrise and sunset.
export function sun(time, [lat, lon]) {
  const rad = Math.PI / 180, d = time / 864e5 - 10957.5; // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad, l = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad; // mean anomaly, ecliptic longitude
  const e = (23.439 - 4e-7 * d) * rad, dec = Math.asin(Math.sin(e) * Math.sin(l)), ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l));
  const ha = (280.46061837 + 360.98564736629 * d + lon) * rad - ra; // local hour angle, from sidereal time
  return { elevation: Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad, rising: Math.sin(ha) < 0 };
}
export const sunNow = (time = Date.now()) => sun(time, place || STOCKHOLM);
// Dark out: the darker half of civil twilight on, when the street lamps and windows are lit.
export const isNight = elevation => elevation < -4;
// True when the place changed, so a theme can repaint now rather than at its next check.
export function setSunPlace(location) {
  if (String(location || null) === String(place)) return false;
  place = location || null;
  return true;
}
