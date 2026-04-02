// public/sw.js — Paso Push Notification Service Worker

self.addEventListener("push", (event) => {
  let data = { title: "Paso", body: "Time to check in on your goal!", url: "/" };

  try {
    if (event.data) {
      data = { ...data, ...event.data.json() };
    }
  } catch (e) {
    console.error("Push parse error:", e);
  }

  const options = {
    body: data.body,
    icon: "/icon-192.png",       // Your app icon — add to public/
    badge: "/badge-72.png",      // Small monochrome badge — add to public/
    tag: "paso-nudge",           // Replace previous notification
    renotify: true,
    data: { url: data.url || "/" },
    actions: [
      { action: "open", title: "Check progress" },
      { action: "dismiss", title: "Later" },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  if (event.action === "dismiss") return;

  // Focus existing tab or open new one
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes("paso") && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// Activate immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});
