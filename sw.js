// Service Worker für die Aufmaßsoftware
// Seit v6.2: App-Dateien NETZWERK ZUERST (Updates kommen sofort an), Zwischenspeicher nur als Offline-Fallback.
// Versionsnummer bei jedem Deploy mit Inhaltsänderungen erhöhen, damit Nutzer die neue Version bekommen.
const CACHE_VERSION = "am2-v6-2";
const CACHE_PREFIX = "am2-";
// Eigener Cache für den großen DATANORM-Katalog (~125 MB). Wird bei
// App-Updates NICHT gelöscht, damit nicht bei jeder neuen App-Version der
// komplette Katalog erneut heruntergeladen werden muss. Die Chunk-URLs
// enthalten ?v=<Katalog-Version>; app.js räumt alte Versionen selbst auf.
const KATALOG_CACHE = "am2-katalog";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./bauaufmass.js",
  "./diktat.js",
  "./datenbank.js",
  "./cloudsync.js",
  "./kundenstamm.js",
  "./uebernahme.js",
  "./materialsuche.js",
  "./mitarbeiter.js",
  "./katalog.js",
  "./firebase-config.js",
  "./vendor/firebase-app-compat.js",
  "./vendor/firebase-auth-compat.js",
  "./vendor/firebase-firestore-compat.js",
  "./manifest.json",
  "./standardmaterial.json",
  "./vendor/jspdf.umd.min.js",
  "./vendor/jspdf.plugin.autotable.min.js",
  "./vendor/html5-qrcode.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];
// Die "Aus Liste"-Materialdaten (materials-chunks/*, insgesamt ca. 125 MB, eigener Cache s. o.)
// werden bewusst NICHT hier in CORE_ASSETS vorab beim Install geladen –
// das könnte die Installation auf einer langsamen/instabilen Verbindung
// zum Scheitern bringen. Stattdessen fragt app.js sie beim Start ganz normal
// per fetch() ab; der generische Cache-first-Handler unten cached sie dabei
// wie jede andere Datei auch, sodass sie ab dem zweiten Start aus dem Cache
// kommen (auch offline) und nicht erneut heruntergeladen werden müssen.

self.addEventListener("install", (event) => {
  // Neue Version sofort aktivieren (kein Warten auf geschlossene Tabs); app.js lädt die Seite danach neu.
  // Dateien am HTTP-Cache vorbei holen, damit wirklich der neue Stand im Cache landet.
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE_ASSETS.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // nur eigene alte Caches löschen – die bisherige App (gleiche Domain) und der Katalog bleiben
      Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION && k !== KATALOG_CACHE && k !== "am2-katalog-lokal").map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Weiterhin unterstützt (ältere app.js-Versionen schicken das nach Klick auf das Update-Banner).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Netzwerk zuerst: immer am HTTP-Cache vorbei beim Server nachfragen (GitHub Pages cached sonst ~10 Min.).
// Ist die Verbindung weg oder antwortet der Server nicht binnen 4 s, kommt die gespeicherte Kopie
// (Baustelle ohne Netz). Die frische Antwort landet dabei trotzdem im Cache.
const NETZ_TIMEOUT_MS = 4000;
async function netzwerkZuerst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
  const netz = fetch(req, { cache: "no-cache" }).then((response) => {
    if (response && response.status === 200 && response.type === "basic") cache.put(req, response.clone()).catch(() => {});
    return response;
  });
  if (!cached) return netz;
  const zeitlimit = new Promise((resolve) => setTimeout(() => resolve(cached), NETZ_TIMEOUT_MS));
  return Promise.race([netz.catch(() => cached), zeitlimit]);
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // Fremde Adressen (Firebase/Google-Server für Anmeldung + Cloud-Sync) nie über den Cache
  if (url.origin !== self.location.origin) return;

  // Katalog-Chunks (groß, Adresse enthält ?v=<Version>): Cache-first im eigenen Katalog-Cache
  if (url.pathname.includes("/materials-chunks/materials-chunk-")) {
    event.respondWith(
      caches.open(KATALOG_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone()).catch(() => {});
            }
            return response;
          });
        })
      )
    );
    return;
  }

  // Alles andere (index.html, app.js, style.css, Manifest, Firebase-Konfiguration, Vendor …): Netzwerk zuerst
  event.respondWith(netzwerkZuerst(event.request).catch(() => caches.match(event.request, { ignoreSearch: true })));
});
