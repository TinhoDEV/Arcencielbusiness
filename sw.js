/* =================================================================
   Arc en Ciel Business — Service Worker (sw.js)
   Permet l'installation comme application (PWA) et le lancement
   hors-ligne de l'interface. Les données restent gérées par Supabase
   (jamais mises en cache) : les appels réseau vers supabase.co et les
   API passent toujours directement par le réseau.
   ================================================================= */
const CACHE = "acb-cache-20260924a";

// Fichiers de l'interface à garder pour le démarrage hors-ligne.
const SHELL = [
  "index.html", "staff.html", "admin.html",
  "panneau-staff.html", "panneau-admin.html",
  "base-de-donnees.html", "cartes-retirees.html",
  "journal.html", "imprimer-cartes.html",
  "style.css?v=20260924a",
  "auth.js?v=20260924a", "db.js?v=20260924a",
  "app.js?v=20260924a", "admin.js?v=20260924a", "staff.js?v=20260924a",
  "panneau-admin.js?v=20260924a", "panneau-staff.js?v=20260924a",
  "base-de-donnees.js?v=20260924a", "cartes-retirees.js?v=20260924a",
  "journal.js?v=20260924a", "imprimer-cartes.js?v=20260924a",
  "inactivity.js?v=20260924a",
  "logo.jpg", "icon-192.png", "icon-512.png", "icon-maskable-512.png",
  "manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // addAll échoue si un fichier manque : on ajoute individuellement, sans bloquer.
      Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))
    )
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // 1) Jamais de cache pour Supabase / API / autres origines : réseau direct.
  if (url.origin !== self.location.origin || /supabase\.co/.test(url.host)) {
    return; // laisse le navigateur gérer normalement
  }

  // 2) Navigation (pages HTML) : réseau d'abord, repli sur le cache hors-ligne.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((m) => m || caches.match("index.html")))
    );
    return;
  }

  // 3) Ressources statiques (CSS/JS/images) : cache d'abord, sinon réseau.
  e.respondWith(
    caches.match(req).then((m) => m || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => m))
  );
});
