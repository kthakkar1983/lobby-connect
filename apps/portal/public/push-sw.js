// Lobby Connect push service worker.
// Contract: every push shows an OS notification (Chrome silent-push budget)
// AND messages open tabs; the TAB owns ring audio (audible contract, spec §3.2).

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const type = data.type || "incoming-call";
  const propertyName = data.propertyName || "a property";

  event.waitUntil(
    (async () => {
      // Tell every open portal tab first — the tab plays the loud primed ring.
      const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const tab of tabs) {
        tab.postMessage({ source: "lc-push", ...data, receivedAt: Date.now() });
      }
      if (type === "call-cleared") {
        // Close the matching incoming toast; no new notification.
        const existing = await self.registration.getNotifications({ tag: data.callId || "" });
        for (const n of existing) n.close();
        return;
      }
      await self.registration.showNotification("Lobby Connect — incoming call", {
        body: `Incoming ${data.channel === "AUDIO" ? "phone" : "video"} call · ${propertyName}`,
        tag: data.callId || "lc-incoming",
        requireInteraction: true,
        icon: "/brand/mark.svg",
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (tabs.length > 0) {
        await tabs[0].focus();
        // Ask the tab to navigate home so the ringing card is on screen.
        tabs[0].postMessage({ source: "lc-push", type: "focus-home" });
        return;
      }
      await self.clients.openWindow("/");
    })(),
  );
});
