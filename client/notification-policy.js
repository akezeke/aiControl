const categories = ['permissions', 'questions', 'completions', 'errors'];
const clockMinutes = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
const projectPath = value => typeof value === 'string' && value ? value.replace(/\/+$/, '') || '/' : '';
const formatters = new Map();

function timeFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (formatters.size >= 32) formatters.delete(formatters.keys().next().value);
    formatters.set(timeZone, formatter);
  }
  return formatters.get(timeZone);
}

// Explicit zones make a shared schedule behave identically on the server and every device.
export function normalizeNotificationPolicy(policy = {}) {
  const quiet = policy?.quietHours;
  let timeZone = typeof quiet?.timeZone === 'string' ? quiet.timeZone : 'UTC';
  try { timeFormatter(timeZone); } catch { timeZone = 'UTC'; }
  const start = clockMinutes(quiet?.start), end = clockMinutes(quiet?.end);
  return {
    categories: Object.fromEntries(categories.map(category => [category, policy?.categories?.[category] !== false])),
    mutedProjects: Array.isArray(policy?.mutedProjects) ? [...new Set(policy.mutedProjects.map(projectPath).filter(Boolean))] : [],
    quietHours: { enabled: quiet?.enabled === true && start !== null && end !== null, start: start === null ? '22:00' : quiet.start, end: end === null ? '07:00' : quiet.end, timeZone },
  };
}

export function notificationCategory(event) {
  if (event?.kind === 'input') return event.session?.status === 'permission' ? 'permissions' : 'questions';
  if (event?.kind === 'ready') return 'completions';
  if (event?.kind === 'error') return 'errors';
  return null;
}

export function notificationAllowed(event, policy, now = Date.now()) {
  const normalized = normalizeNotificationPolicy(policy), category = notificationCategory(event);
  if (!category || !normalized.categories[category] || normalized.mutedProjects.includes(projectPath(event.session?.cwd))) return false;
  const quiet = normalized.quietHours;
  if (!quiet.enabled) return true;
  const start = clockMinutes(quiet.start), end = clockMinutes(quiet.end);
  // Equal endpoints are an empty interval, so an accidental equal-time setting cannot silence the day.
  if (start === end) return true;
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return true;
  const parts = timeFormatter(quiet.timeZone).formatToParts(date);
  const minute = Number(parts.find(part => part.type === 'hour').value) * 60 + Number(parts.find(part => part.type === 'minute').value);
  const inQuietHours = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  return !inQuietHours;
}
