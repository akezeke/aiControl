// Only shows notifications and routes their clicks; it caches and intercepts nothing.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    if (!windows.length) return self.clients.openWindow(`/#${new URLSearchParams({ session: event.notification.tag })}`);
    windows[0].postMessage({ open: event.notification.tag });
    return windows[0].focus();
  }));
});
