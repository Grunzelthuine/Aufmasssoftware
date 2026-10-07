// Service Worker für die Aufmaßsoftware (Testversion, eigener Bereich neben der bisherigen App)
// Versionsnummer bei jedem Deploy mit Inhaltsänderungen erhöhen, damit Nutzer die neue Version bekommen.
const CACHE_VERSION = "am2-v1";
const CACHE_PREFIX = "am2-";
// Eigener Cache für den großen DATANORM-Katalog (~125 MB). Wird bei
// App-Updates NICHT gelöscht, damit nicht bei jeder neuen App-Version der
// komplette Katalog erneut heruntergeladen werden muss. Die Chunk-URLs
// enthalten ?v=<Katalog-Version>; app.js räumt alte Versionen selbst auf.
const KATALOG_CACHE = "aufmass-katalog";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./bauaufmass.js",
  "./diktat.js",
  "./datenbank.js",
  "./cloudsync.js",
  "./uebernahme.js",
  "./materialsuche.js",
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
  // Bewusst KEIN self.skipWaiting() hier: eine neue Version soll erst
  // aktiv werden, wenn der Nutzer im Update-Banner "Jetzt aktualisieren"
  // klickt (siehe Message-Handler unten). Bei der allerersten Installation
  // gibt es ohnehin noch keine aktive Version, die warten müsste.
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // nur eigene alte Caches löschen – die bisherige App (gleiche Domain) und der gemeinsame Katalog bleiben
      Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Wird von app.js aufgerufen, wenn der Nutzer im Update-Banner bestätigt.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Cache-first, damit die App auf der Baustelle auch ohne Netz zuverlässig läuft.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // Fremde Adressen (Firebase/Google-Server für Anmeldung + Cloud-Sync) nie über den Cache
  if (url.origin !== self.location.origin) return;

  // Firebase-Konfiguration: Netzwerk zuerst, damit eine nachträglich eingetragene
  // Konfiguration ohne neue CACHE_VERSION ankommt; offline aus dem Cache.
  if (url.pathname.endsWith("/firebase-config.js")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Katalog-Chunks: Cache-first im eigenen Katalog-Cache
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

  // Katalog-Manifest: Netzwerk zuerst (klein), damit ein neuer Katalog erkannt
  // wird; offline aus dem Cache.
  if (url.pathname.endsWith("/materials-chunks/materials-manifest.json")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(url.pathname, clone));
          }
          return response;
        })
        .catch(() => caches.match(url.pathname))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
