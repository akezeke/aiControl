// Push notifications and their clicks; the worker caches and intercepts nothing.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* show a generic notification */ }
  const id = typeof data.id === 'string' ? data.id : '';
  const title = data.kind !== 'input' ? 'Done' : data.status === 'permission' ? 'Permission needed' : data.status === 'question' ? 'Question for you' : 'Needs you';
  const parts = [data.project, data.title].filter(value => typeof value === 'string' && value.trim());
  const body = [...new Set(parts)].join(' · ') || 'Open AI Control';
  event.waitUntil(self.registration.showNotification(title, {
    body, tag: id || 'ai-control', data: { id }, icon: '/icon-192.png',
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data?.id || event.notification.tag;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    if (!windows.length) return self.clients.openWindow(`/#${new URLSearchParams({ session: id })}`);
    windows[0].postMessage({ open: id });
    return windows[0].focus();
  }));
});
