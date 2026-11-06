// Push notifications and their clicks; the worker caches and intercepts nothing.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* show a generic notification */ }
  const id = typeof data.id === 'string' ? data.id : '';
  event.waitUntil(self.registration.showNotification(data.kind === 'input' ? 'Needs you' : 'Done', {
    body: 'Open AI Control', tag: id || 'ai-control', data: { id }, icon: '/icon-192.png',
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
