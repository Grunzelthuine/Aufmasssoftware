"use strict";

/* ============================================================
   Material-Aufmaß App
   Speicherung: localStorage (rein lokal auf dem Gerät)
   Materialstamm "Aus Liste": DATANORM-Katalog (Chunk-Dateien, im Speicher)
   Materialstamm "Standardmaterial": standardmaterial.json (klein, im Speicher)
   ============================================================ */

const STORAGE_KEY = "am2_liste";
const STORAGE_KEY_PACKLISTEN = "am2_packlisten";
const STORAGE_KEY_FAVORITEN = "am2_favoriten";
const STORAGE_KEY_STANDARD_ERGAENZUNGEN = "am2_standard_ergaenzungen";
const STORAGE_KEY_EIGENE_ARTIKEL = "am2_eigene_artikel"; // selbst angelegte EAN-Artikel (v9.2)
const app = document.getElementById("app");
const headerTitle = document.getElementById("headerTitle");
const btnBack = document.getElementById("btnBack");
const btnNew = document.getElementById("btnNew");

const STANDARD_KATEGORIEN = [
  "Kabel & Leitungen", "Dosen", "Schalter & Steckdosen", "Sicherungstechnik & Verteiler",
  "Beleuchtung & LED-Zubehör", "Leerrohre & Kanäle", "Verbindungs- & Befestigungsmaterial",
  "Erdung & Blitzschutz", "Netzwerktechnik", "Sensorik & Steuerung",
  "Kleinteile & Verbrauchsmaterial", "Sonstige Standardartikel"
];

let aufmassListe = [];      // alle gespeicherten Aufmaße
let currentAufmass = null;  // aktuell im Formular geöffnetes Aufmaß
let packlisten = [];          // alle gespeicherten Packlisten
let currentPackliste = null;  // aktuell geöffnete Packliste
let standardMaterialDB = [];      // Materialstamm aus standardmaterial.json + eigene Ergänzungen
let standardMaterialDBReady = false;
let selectedArtikel = null;         // aktuell gewähltes Material (Tab "Aus Liste")
let selectedStandardArtikel = null; // aktuell gewähltes Material (Tab "Standardmaterial")
let selectedFavoritArtikel = null;  // aktuell gewähltes Material (Tab "Favoriten")
let favoritenCounts = {};           // Nutzungszähler für die selbstlernende Favoriten-Funktion
let customStandardMaterial = [];    // vom Nutzer aus "Aus Liste" übernommene Standardmaterial-Ergänzungen
let saveTimer = null;
let zurueckAktion = null;           // Ziel des Zurück-Buttons (null = Übersicht), z. B. Raum -> Bauaufmaß

/* ---------- Storage ---------- */

function ladeListe() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    aufmassListe = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Fehler beim Laden der gespeicherten Aufmaße", e);
    aufmassListe = [];
  }
}

function speichereListe() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(aufmassListe));
  } catch (e) {
    console.error("Fehler beim Speichern", e);
    alert("Speichern fehlgeschlagen (evtl. Speicher voll). Bitte PDF sichern.");
  }
}

function istLeeresAufmass(a) {
  return (
    !a.kunde.name.trim() &&
    !a.kunde.ansprechpartner.trim() &&
    !a.kunde.strasse.trim() &&
    !a.kunde.plzOrt.trim() &&
    !a.kunde.telefon.trim() &&
    !a.baustelle.trim() &&
    !a.arbeitsbeschreibung.trim() &&
    a.material.length === 0
  );
}

function upsertCurrentInListe() {
  const idx = aufmassListe.findIndex((a) => a.id === currentAufmass.id);
  currentAufmass.geaendert = new Date().toISOString();
  if (idx >= 0) {
    aufmassListe[idx] = currentAufmass;
  } else {
    aufmassListe.unshift(currentAufmass);
  }
  speichereListe();
}

function ladePacklisten() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PACKLISTEN);
    packlisten = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Fehler beim Laden der gespeicherten Packlisten", e);
    packlisten = [];
  }
}

function speicherePacklisten() {
  try {
    localStorage.setItem(STORAGE_KEY_PACKLISTEN, JSON.stringify(packlisten));
  } catch (e) {
    console.error("Fehler beim Speichern", e);
    alert("Speichern fehlgeschlagen (evtl. Speicher voll).");
  }
}

function istLeerePackliste(p) {
  return !p.bezeichnung.trim() && p.material.length === 0;
}

function upsertCurrentPackliste() {
  const idx = packlisten.findIndex((p) => p.id === currentPackliste.id);
  currentPackliste.geaendert = new Date().toISOString();
  if (idx >= 0) {
    packlisten[idx] = currentPackliste;
  } else {
    packlisten.unshift(currentPackliste);
  }
  speicherePacklisten();
}

/* ---------- Favoriten (selbstlernend) ----------
   Zählt bei jedem Hinzufügen aus "Aus Liste" oder "Standardmaterial", wie
   oft ein Artikel verwendet wurde (global, unabhängig davon ob er in ein
   Aufmaß oder eine Packliste eingetragen wird). Freitext wird bewusst nicht
   gezählt, da jede Freitext-Position i. d. R. einmalig ist. */

function ladeFavoriten() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FAVORITEN);
    favoritenCounts = raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Favoriten konnten nicht geladen werden", e);
    favoritenCounts = {};
  }
}

function speichereFavoriten() {
  try {
    localStorage.setItem(STORAGE_KEY_FAVORITEN, JSON.stringify(favoritenCounts));
  } catch (e) {
    console.error("Favoriten konnten nicht gespeichert werden", e);
  }
}

function favoritenSchluessel(quelle, artikelnummer, bezeichnung) {
  if (quelle === "liste") return "liste:" + artikelnummer;
  if (quelle === "standard") return "standard:" + bezeichnung;
  return null;
}

function registriereFavoritTreffer(quelle, artikelnummer, bezeichnung, einheit) {
  const key = favoritenSchluessel(quelle, artikelnummer, bezeichnung);
  if (!key) return;
  const eintrag = favoritenCounts[key] || { count: 0, quelle, artikelnummer: artikelnummer || "", bezeichnung, einheit };
  eintrag.count += 1;
  eintrag.bezeichnung = bezeichnung;
  eintrag.einheit = einheit;
  favoritenCounts[key] = eintrag;
  speichereFavoriten();
}

/* ---------- Favoriten per Stern (v16) ----------
   In die Favoriten kommt nur, was mit ☆ markiert wurde (Materialdatenbank,
   Standardmaterial, Aus Liste). Sortiert nach Nutzungshäufigkeit
   (favoritenCounts, zählt weiterhin jedes Hinzufügen). */
const STORAGE_KEY_STERNE = "am2_sterne";
let sterne = {}; // key -> { quelle, artikelnummer, bezeichnung, einheit }

function ladeSterne() {
  try { sterne = JSON.parse(localStorage.getItem(STORAGE_KEY_STERNE) || "{}") || {}; }
  catch (e) { sterne = {}; }
}

function speichereSterne() {
  try { localStorage.setItem(STORAGE_KEY_STERNE, JSON.stringify(sterne)); }
  catch (e) { console.error("Favoriten konnten nicht gespeichert werden", e); }
}

function istStern(key) { return !!sterne[key]; }

function toggleStern(d) {
  if (sterne[d.key]) delete sterne[d.key];
  else sterne[d.key] = { quelle: d.quelle, artikelnummer: d.artikelnummer || "", bezeichnung: d.bezeichnung, einheit: d.einheit || "Stck" };
  speichereSterne();
  return !!sterne[d.key];
}

function sternDatenFuerDb(m) {
  return { key: "standard:" + m.name, quelle: "standard", artikelnummer: m.nr || "", bezeichnung: m.name, einheit: m.einheit || "Stck" };
}

function sternDatenFuerStandard(item) {
  return { key: "standard:" + item.b, quelle: "standard", artikelnummer: item.n || "", bezeichnung: item.b, einheit: item.e };
}

function sternDatenFuerKatalog(item) {
  if (item._dbId) return sternDatenFuerStandard(item);
  return { key: "liste:" + item.n, quelle: "liste", artikelnummer: item.n, bezeichnung: item.b, einheit: item.e };
}

// Stern-Knopf (☆/★); onChange optional
function bindeSternKnopf(btn, daten, onChange) {
  const zeichne = () => {
    const an = istStern(daten.key);
    btn.textContent = an ? "★" : "☆";
    btn.classList.add("stern-btn");
    btn.classList.toggle("aktiv", an);
    btn.setAttribute("aria-label", an ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen");
  };
  zeichne();
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    toggleStern(daten);
    zeichne();
    if (onChange) onChange();
  });
  return btn;
}

function neuerSternKnopf(daten, onChange) {
  const btn = document.createElement("button");
  btn.type = "button";
  return bindeSternKnopf(btn, daten, onChange);
}

function nutzung(key) {
  return (favoritenCounts[key] && favoritenCounts[key].count) || 0;
}

// Favoriten = nur Sterne, nach Häufigkeit der Nutzung (viel -> wenig)
function topFavoriten() {
  return Object.entries(sterne)
    .map(([key, d]) => ({ key, ...d, count: nutzung(key) }))
    .sort((a, b) => b.count - a.count || a.bezeichnung.localeCompare(b.bezeichnung, "de"));
}

/* ---------- Standardmaterial (v15) ----------
   Kommt jetzt aus der zentralen Materialdatenbank (datenbank.js). */

function ladeCustomStandardMaterial() { /* v15: in der Materialdatenbank enthalten */ }

// Artikel aus „Aus Liste“ in die Materialdatenbank übernehmen
function nehmeInStandardmaterialAuf(katId, bezeichnung, einheit, nr, ean, ordner) {
  return dbNeu({ kat: katId, name: bezeichnung, nr: nr || "", ean: ean || "", einheit, ordner });
}

/* ---------- Barcode-Scanner (Kamera) ----------
   Nutzt die lokal eingebundene Bibliothek html5-qrcode (vendor/), die auch
   in mobilem Safari/iOS ohne native Barcode-Detection-API funktioniert.
   Scannt verschiedenste Formate (Code128, EAN-13/8, QR, ...). Das Ergebnis
   wird zuerst als Hersteller-EAN gesucht (Feld "g" im Katalog, stammt aus
   den B-Sätzen der Sonepar-DATANORM, ca. 92 % der Artikel haben eine),
   dann als exakte Artikelnummer, sonst als normale Textsuche. */

let html5QrcodeScanner = null;
let barcodeScanErgebnisCallback = null;

function oeffneBarcodeScanner(onErgebnis) {
  const overlay = document.getElementById("scannerOverlay");
  const hinweis = document.getElementById("scannerHinweis");
  const manuellInput = document.getElementById("scannerManuellInput");
  if (typeof Html5Qrcode === "undefined") {
    alert("Barcode-Scanner konnte nicht geladen werden.");
    return;
  }
  barcodeScanErgebnisCallback = onErgebnis;
  overlay.hidden = false;
  hinweis.textContent = "Kamera wird gestartet…";
  manuellInput.value = "";

  // Explizit alle relevanten Formate anfordern (1D-Barcodes wie EAN/Code128
  // UND QR), statt sich auf die Bibliotheks-Voreinstellung zu verlassen.
  const formate = [
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.CODABAR,
    Html5QrcodeSupportedFormats.ITF,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E
  ];
  html5QrcodeScanner = new Html5Qrcode("scannerReader", { formatsToSupport: formate, verbose: false });

  // Etwas höhere Kamera-Auflösung anfordern, damit auch dünne Strichcode-
  // Balken (EAN/Code128) sauber aufgelöst werden – die Standardauflösung
  // mancher Handykameras ist dafür zu niedrig. Breiterer, flacherer Scan-
  // Rahmen passend zur Form eines 1D-Barcodes statt eines Quadrats.
  const config = {
    fps: 12,
    // Scan-Rahmen relativ zum (verkleinerten) Kamerabild
    qrbox: (w, h) => ({ width: Math.floor(Math.min(280, w * 0.85)), height: Math.floor(Math.min(130, h * 0.6)) }),
    aspectRatio: 1.7,
    videoConstraints: {
      facingMode: "environment",
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  };

  html5QrcodeScanner
    .start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        schliesseBarcodeScanner();
        onErgebnis(decodedText);
      },
      () => { /* laufender Frame ohne Treffer, kein Fehler */ }
    )
    .then(() => {
      hinweis.textContent = "Barcode in den Rahmen halten – ruhig, gut ausgeleuchtet und nah heranhalten.";
    })
    .catch((err) => {
      hinweis.textContent = "Kamera konnte nicht gestartet werden (Berechtigung erteilt?).";
      console.error("Barcode-Scanner-Start fehlgeschlagen", err);
    });
}

function schliesseBarcodeScanner() {
  const overlay = document.getElementById("scannerOverlay");
  // v15: Overlay zuerst schließen – stop() wirft sofort einen Fehler, wenn die
  // Kamera gar nicht gestartet war (z. B. keine Berechtigung). Vorher blieb
  // das Overlay dann offen und „Schließen“ schien nicht zu funktionieren.
  overlay.hidden = true;
  barcodeScanErgebnisCallback = null;
  if (html5QrcodeScanner) {
    const scanner = html5QrcodeScanner;
    html5QrcodeScanner = null;
    try {
      Promise.resolve(scanner.stop()).then(() => scanner.clear()).catch(() => { try { scanner.clear(); } catch (e) { /* egal */ } });
    } catch (e) {
      try { scanner.clear(); } catch (e2) { /* egal */ }
    }
  }
}

function barcodeManuellSuchen() {
  const input = document.getElementById("scannerManuellInput");
  const code = input.value.trim();
  if (!code) { input.focus(); return; }
  const callback = barcodeScanErgebnisCallback;
  schliesseBarcodeScanner();
  if (callback) callback(code);
}

function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (currentAufmass && !istLeeresAufmass(currentAufmass)) {
      upsertCurrentInListe();
    }
    if (currentPackliste && !istLeerePackliste(currentPackliste)) {
      upsertCurrentPackliste();
    }
    if (typeof autosaveBauaufmass === "function") autosaveBauaufmass();
  }, 300);
}

/* ---------- Hilfsfunktionen ---------- */

function neueId() {
  return "am_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function heuteISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatDatumDE(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// "m", "M", " m " etc. gelten als Meter-Einheit (für die Mengen-Zusatzeingabe).
function istMeterEinheit(einheit) {
  return (einheit || "").trim().toLowerCase() === "m";
}

function rundeMenge(n) {
  return Math.round(n * 100) / 100;
}

function neuesAufmass() {
  return {
    id: neueId(),
    erstellt: new Date().toISOString(),
    geaendert: new Date().toISOString(),
    datum: heuteISO(),
    kunde: { name: "", ansprechpartner: "", strasse: "", plzOrt: "", telefon: "" },
    baustelle: "",
    arbeitsbeschreibung: "",
    material: []
  };
}

function neuePackliste() {
  return {
    id: neueId(),
    erstellt: new Date().toISOString(),
    geaendert: new Date().toISOString(),
    bezeichnung: "",
    datum: heuteISO(),
    material: [] // { id, bezeichnung, artikelnummer, einheit, menge, quelle, erledigt }
  };
}

/* ---------- Materialstamm "Aus Liste" (DATANORM, Chunk-Dateien) ----------
   Der DATANORM-Vollsortiments-Katalog hat über eine Million Artikel
   (>100 MB als JSON) – zu groß für eine einzelne Datei (GitHub-Limit 100 MB
   pro Datei). Er liegt daher in mehreren Chunk-Dateien
   (materials-chunks/materials-chunk-*.json, siehe tools/datanorm_to_json.py)
   und wird beim App-Start komplett geladen und in ein Array im Speicher
   gehalten – genau wie zuvor bei der kleineren materials.json, nur eben
   aus mehreren Dateien zusammengesetzt. Das wurde bewusst so (und nicht
   über eine IndexedDB mit Volltext-Index) umgesetzt: ein Test hat gezeigt,
   dass der Aufbau eines Wort-Index für über eine Million Artikel in
   IndexedDB mehrere zehn Minuten dauern würde, während Laden+Aufbau des
   Suchcaches als einfaches Array in unter 3 Sekunden fertig ist (Chrome,
   gemessen) und auch die Suche selbst danach durchgehend unter 100 ms
   bleibt, selbst im ungünstigsten Fall (kein Treffer, kompletter Scan).
   Der Service Worker cached die Chunk-Dateien wie jede andere Datei auch,
   sodass sie nur beim allerersten Start (bzw. nach einer neuen DATANORM-
   Datei mit geänderter CACHE_VERSION) tatsächlich übers Netz geladen werden
   müssen. */

// Aufmaßsoftware: der große Großhandelskatalog (~125 MB) wird aus der bisherigen App
// (gleiche Domain) mitbenutzt – nicht doppelt im Repo, und der Offline-Cache wird geteilt.
const KATALOG_BASIS = "../Aufmass/materials-chunks/";
let materialDB = [];        // Materialstamm "Aus Liste", aus den Chunk-Dateien zusammengesetzt
let materialDBReady = false;
let materialDBFehler = null;
let materialDBStatus = "Materialliste wird geladen…";
let materialDBLaedt = false;
const materialDBListener = new Set(); // UI-Callbacks, die bei Fortschritt/Fertig neu zeichnen

function meldeMaterialDBStatus() {
  materialDBListener.forEach((fn) => {
    try { fn(); } catch (e) { console.error(e); }
  });
}

/* v9.1: speicherschonender und mit Fortschrittsanzeige.
   - max. 3 Chunks gleichzeitig laden (statt alle 9 parallel)
   - Suchstring _s direkt am Objekt ergänzen statt jedes der 1,24 Mio.
     Objekte per {...a} zu kopieren (hat den Speicherbedarf verdoppelt –
     auf dem iPhone kritisch)
   - Chunk-URLs mit ?v=<Katalog-Version>, damit der Service Worker den
     Katalog in einem eigenen Cache halten kann, der App-Updates überlebt
   - nach Fehler automatischer neuer Versuch, sobald wieder online */
async function ladeMaterialDB() {
  if (materialDBLaedt || materialDBReady) return;
  materialDBLaedt = true;
  materialDBFehler = null;
  try {
    const manifestRes = await fetch(KATALOG_BASIS + "materials-manifest.json", { cache: "no-cache" })
      .catch(() => fetch(KATALOG_BASIS + "materials-manifest.json"));
    if (!manifestRes.ok) throw new Error("Manifest: HTTP " + manifestRes.status);
    const manifest = await manifestRes.json();
    const anzahl = manifest.chunks.length;
    const teile = new Array(anzahl);
    let fertig = 0;
    materialDBStatus = `Materialliste wird geladen… (0 von ${anzahl})`;
    meldeMaterialDBStatus();

    let naechster = 0;
    async function arbeiter() {
      while (naechster < anzahl) {
        const idx = naechster++;
        const datei = manifest.chunks[idx];
        const res = await fetch(`${KATALOG_BASIS}${datei}?v=${encodeURIComponent(manifest.version || "")}`);
        if (!res.ok) throw new Error(`${datei}: HTTP ${res.status}`);
        const arr = await res.json();
        for (let i = 0; i < arr.length; i++) {
          const a = arr[i];
          a._s = (a.n + " " + a.b).toLowerCase();
        }
        teile[idx] = arr;
        fertig++;
        materialDBStatus = `Materialliste wird geladen… (${fertig} von ${anzahl})`;
        meldeMaterialDBStatus();
      }
    }
    await Promise.all([arbeiter(), arbeiter(), arbeiter()]);

    const alle = [];
    for (let t = 0; t < teile.length; t++) {
      const arr = teile[t];
      for (let i = 0; i < arr.length; i++) alle.push(arr[i]);
      teile[t] = null;
    }
    materialDB = alle;
    materialDBReady = true;
    materialDBFehler = null;
    raeumeAltenKatalogCacheAuf(manifest.version);
  } catch (e) {
    console.error("Materialstamm konnte nicht geladen werden", e);
    materialDB = [];
    materialDBReady = false;
    materialDBFehler = "Materialliste konnte nicht geladen werden (wird automatisch erneut versucht, sobald online)";
  } finally {
    materialDBLaedt = false;
    meldeMaterialDBStatus();
  }
}

// Alte Katalog-Versionen aus dem Katalog-Cache entfernen (nur nach Erfolg).
async function raeumeAltenKatalogCacheAuf(version) {
  try {
    if (!("caches" in window) || !version) return;
    const cache = await caches.open("aufmass-katalog");
    const keys = await cache.keys();
    const v = "v=" + encodeURIComponent(version);
    await Promise.all(keys.filter((k) => !k.url.includes(v)).map((k) => cache.delete(k)));
  } catch (e) { /* unkritisch */ }
}

window.addEventListener("online", () => { if (!materialDBReady) ladeMaterialDB(); });

/* ---------- Eigene Artikel (unbekannte EAN) ----------
   Seit v15 Teil der Materialdatenbank: alle Datenbank-Einträge mit EAN oder
   Art.-Nr. sind in „Aus Liste“ such- und scanbar (siehe datenbank.js). */
let eigeneArtikel = [];

function ladeEigeneArtikel() { aktualisiereAbgeleiteteListen(); }

function legeEigenenArtikelAn(code, bezeichnung, einheit, katId) {
  const m = dbNeu({ kat: katId || KAT_EIGENE, name: bezeichnung, nr: "", ean: code, einheit });
  return eigeneArtikel.find((a) => a._dbId === m.id) || { n: code, b: bezeichnung, e: einheit, g: code, _eigen: true, _dbId: m.id, _s: (code + " " + bezeichnung).toLowerCase() };
}

function istEanAehnlich(code) {
  return /^\d{8,14}$/.test((code || "").trim());
}

/* EAN-Suche: linearer Durchlauf über den Katalog (wie die Textsuche, < 100 ms).
   Bewusst kein Extra-Index (Map mit >1 Mio. Einträgen), um den Speicher auf
   dem iPhone zu schonen – gescannt wird ja nur gelegentlich.
   Varianten: UPC-A (12-stellig) entspricht EAN-13 mit führender 0; manche
   Scanner liefern das eine, der Katalog enthält evtl. das andere. */
function eanVarianten(code) {
  const c = (code || "").trim();
  if (!/^\d{8,14}$/.test(c)) return [];
  const v = new Set([c]);
  if (c.length === 12) v.add("0" + c);
  if (c.length === 13 && c[0] === "0") v.add(c.slice(1));
  if (c.length === 14 && c[0] === "0") v.add(c.slice(1));
  if (c.length === 13) v.add("0" + c); // GTIN-14 mit führender 0
  return [...v];
}

function sucheNachEan(code, limit = 30) {
  const varianten = eanVarianten(code);
  if (varianten.length === 0) return [];
  const treffer = eigeneArtikel.filter((a) => varianten.includes(a.g) || varianten.includes(a.n));
  if (treffer.length >= limit) return treffer.slice(0, limit);
  for (let i = 0; i < materialDB.length; i++) {
    const g = materialDB[i].g;
    if (g && varianten.includes(g)) {
      treffer.push(materialDB[i]);
      if (treffer.length >= limit) break;
    }
  }
  return treffer;
}

function sucheMaterial(query, limit = 30) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const worte = q.split(/\s+/).filter(Boolean);
  // Eingetippte/gescannte EAN (8-14 Ziffern) findet auch den Artikel dazu
  const treffer = worte.length === 1 ? sucheNachEan(worte[0], limit) : [];
  for (const item of eigeneArtikel) {
    if (treffer.includes(item)) continue;
    if (worte.every((w) => item._s.includes(w))) treffer.push(item);
  }
  for (let i = 0; i < materialDB.length; i++) {
    const item = materialDB[i];
    if (treffer.length && treffer.includes(item)) continue;
    let ok = true;
    for (const w of worte) {
      if (!item._s.includes(w)) { ok = false; break; }
    }
    if (ok) {
      treffer.push(item);
      if (treffer.length >= limit) break;
    }
  }
  return treffer;
}

async function ladeStandardMaterialDB() {
  aktualisiereAbgeleiteteListen(); // v15: aus der Materialdatenbank
}

/* ---------- Navigation / Rendering (v15: Startbildschirm + Listen) ----------
   ansicht: "start" | "liste" | "detail" | "datenbank" | "konto"
   aktuellerBereich: "aufmass" | "bau" | "packliste" (welche Liste angezeigt wird) */

let ansicht = "start";
let aktuellerBereich = null;

function setzeAnsicht(name) { ansicht = name; }

const BEREICHE = {
  aufmass: { titel: "Aufmaße", einzeln: "Aufmaß", icon: "📋", neu: () => oeffneFormular(neuesAufmass()) },
  bau: { titel: "Bauaufmaße", einzeln: "Bauaufmaß", icon: "🏠", neu: () => oeffneBauaufmass(neuesBauaufmass()) },
  packliste: { titel: "Packlisten", einzeln: "Packliste", icon: "📦", neu: () => oeffnePackliste(neuePackliste()) }
};

// Nach dem Löschen aufrufen (vor zeigeUebersicht), damit der Autosave-Flush
// das gerade gelöschte Element nicht wieder in die Liste schreibt.
function verwerfeAktuellesOhneSpeichern() {
  clearTimeout(saveTimer);
  currentAufmass = null;
  currentPackliste = null;
  if (typeof currentBauaufmass !== "undefined") currentBauaufmass = null;
  if (typeof currentRaum !== "undefined") currentRaum = null;
}

// Ausstehenden Autosave sofort ausführen und offene Einträge schließen
function schliesseOffeneEintraege() {
  clearTimeout(saveTimer);
  if (typeof msSnackAus === "function") msSnackAus();
  if (currentAufmass && !istLeeresAufmass(currentAufmass)) upsertCurrentInListe();
  if (currentPackliste && !istLeerePackliste(currentPackliste)) upsertCurrentPackliste();
  if (typeof autosaveBauaufmass === "function") autosaveBauaufmass();
  currentAufmass = null;
  currentPackliste = null;
  currentBauaufmass = null;
  currentRaum = null;
  zurueckAktion = null;
  selectedArtikel = null;
  selectedStandardArtikel = null;
  selectedFavoritArtikel = null;
}

// Neu zeichnen, falls gerade Start oder eine Liste angezeigt wird (z. B. nach Cloud-Sync)
function aktualisiereListenansicht() {
  if (ansicht === "start") zeigeStart();
  else if (ansicht === "liste") zeigeUebersicht();
}

function zeigeStart() {
  schliesseOffeneEintraege();
  setzeAnsicht("start");
  aktuellerBereich = null;
  headerTitle.textContent = "Aufmaßsoftware";
  btnBack.hidden = true;
  btnNew.hidden = true;
  app.innerHTML = "";
  const view = document.createElement("section");
  view.className = "view";
  const kachel = (icon, titel, info, onClick, klasse) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "kachel " + (klasse || "");
    b.innerHTML = `<span class="kachel-icon">${icon}</span><span class="kachel-text"><strong></strong><small></small></span><span class="chevron">›</span>`;
    b.querySelector("strong").textContent = titel;
    b.querySelector("small").textContent = info;
    b.addEventListener("click", onClick);
    return b;
  };
  const anz = (n, s, p) => `${n} ${n === 1 ? s : p}`;
  view.appendChild(kachel("📋", "Aufmaß", anz(aufmassListe.length, "Aufmaß", "Aufmaße") + " · Material je Baustelle", () => { aktuellerBereich = "aufmass"; zeigeUebersicht(); }));
  view.appendChild(kachel("🏠", "Bauaufmaß", anz(bauaufmasse.length, "Bauaufmaß", "Bauaufmaße") + " · Etagen, Räume, Verteilung", () => { aktuellerBereich = "bau"; zeigeUebersicht(); }));
  view.appendChild(kachel("📦", "Packliste", anz(packlisten.length, "Packliste", "Packlisten") + " · Abhaken beim Einladen", () => { aktuellerBereich = "packliste"; zeigeUebersicht(); }));
  view.appendChild(kachel("🗂", "Materialdatenbank", `${dbMaterial.length} Einträge · Standardmaterial, Produkte, eigene Artikel`, () => oeffneDatenbank()));
  const cloudKachel = kachel("☁", "Cloud-Sync", "", () => oeffneCloudKonto(), "kachel-cloud");
  cloudKachel.querySelector("small").id = "cloudStatus";
  view.appendChild(cloudKachel);
  // Aufmaßsoftware: Hinweis Testversion / Übernahme
  const ub = typeof uebernahmeInfo === "function" ? uebernahmeInfo() : {};
  const hinweis = document.createElement("p");
  hinweis.className = "hint start-hinweis";
  hinweis.textContent = "Aufmaßsoftware (Testversion) – eigene Daten, getrennt von der bisherigen Aufmaß-App." +
    (ub.zeit ? ` Daten aus der bisherigen App übernommen am ${formatDatumDE(ub.zeit.slice(0, 10))}.` : "");
  view.appendChild(hinweis);
  app.appendChild(view);
  window.scrollTo(0, 0);
  if (typeof renderCloudStatus === "function") renderCloudStatus();
}

// Liste des aktuellen Bereichs (Aufmaße / Bauaufmaße / Packlisten)
function zeigeUebersicht() {
  schliesseOffeneEintraege();
  if (!aktuellerBereich) { zeigeStart(); return; }
  setzeAnsicht("liste");
  const bereich = BEREICHE[aktuellerBereich];
  headerTitle.textContent = bereich.titel;
  btnBack.hidden = false;
  btnNew.hidden = false;
  app.innerHTML = "";
  const view = document.createElement("section");
  view.className = "view";
  const neu = document.createElement("button");
  neu.type = "button";
  neu.className = "btn btn-primary btn-gross";
  neu.textContent = `＋ Neues ${bereich.einzeln}`;
  if (aktuellerBereich === "packliste") neu.textContent = "＋ Neue Packliste";
  neu.addEventListener("click", bereich.neu);
  view.appendChild(neu);
  const ul = document.createElement("ul");
  ul.className = "card-list";
  view.appendChild(ul);
  const leer = document.createElement("p");
  leer.className = "hint";
  view.appendChild(leer);
  app.appendChild(view);

  // v19.3: gesendete Aufmaße/Bauaufmaße in eigenem, zugeklapptem Bereich
  let ulGesendet = null;
  const gesendetListe = () => {
    if (ulGesendet) return ulGesendet;
    const det = document.createElement("details");
    det.className = "gesendet-bereich";
    det.innerHTML = `<summary>✓ Bereits gesendet (<span class="gesendet-anzahl">0</span>)</summary>`;
    ulGesendet = document.createElement("ul");
    ulGesendet.className = "card-list";
    det.appendChild(ulGesendet);
    leer.before(det);
    return ulGesendet;
  };
  const karte = (titel, meta, onClick, gesendet) => {
    const li = document.createElement("li");
    li.className = "aufmass-card" + (gesendet ? " gesendet" : "");
    li.innerHTML = `<div class="info"><p class="kunde"></p><p class="meta"></p></div><span class="chevron">›</span>`;
    li.querySelector(".kunde").textContent = titel;
    li.querySelector(".meta").textContent = meta;
    if (gesendet) {
      const badge = document.createElement("span");
      badge.className = "gesendet-badge";
      badge.textContent = "✓ gesendet " + formatDatumDE(gesendet.slice(0, 10));
      li.querySelector(".kunde").appendChild(badge);
    }
    li.addEventListener("click", onClick);
    const ziel = gesendet ? gesendetListe() : ul;
    ziel.appendChild(li);
    if (gesendet) ziel.closest("details").querySelector(".gesendet-anzahl").textContent = ziel.children.length;
  };
  const sortiere = (l) => [...l].sort((a, b) => (b.geaendert || "").localeCompare(a.geaendert || ""));

  if (aktuellerBereich === "aufmass") {
    leer.textContent = aufmassListe.length ? "" : "Noch kein Aufmaß erfasst.";
    for (const a of sortiere(aufmassListe)) {
      const n = a.material.length;
      const besch = a.arbeitsbeschreibung.trim();
      karte(a.kunde.name.trim() || "(ohne Kundenname)", `${formatDatumDE(a.datum)} · ${n} Position${n === 1 ? "" : "en"}${besch ? " · " + besch : ""}`, () => oeffneFormular(a), a.gesendet);
    }
  } else if (aktuellerBereich === "packliste") {
    leer.textContent = packlisten.length ? "" : "Noch keine Packliste angelegt.";
    for (const p of sortiere(packlisten)) {
      const offen = p.material.filter((m) => !m.erledigt).length;
      karte(p.bezeichnung.trim() || "(ohne Bezeichnung)", `${formatDatumDE(p.datum)} · ${offen} von ${p.material.length} noch zu packen`, () => oeffnePackliste(p));
    }
  } else if (aktuellerBereich === "bau") {
    leer.textContent = bauaufmasse.length ? "" : "Noch kein Bauaufmaß angelegt.";
    for (const b of sortiere(bauaufmasse)) {
      const nR = b.etagen.reduce((s, e) => s + e.raeume.length, 0);
      const nV = (b.verteilungen || []).length;
      const besch = b.arbeitsbeschreibung.trim();
      karte(b.kunde.name.trim() || "(ohne Kundenname)",
        `${formatDatumDE(erstelltDatumISO(b))} · ${b.etagen.length} Etage${b.etagen.length === 1 ? "" : "n"}, ${nR} Raum${nR === 1 ? "" : "e"}${nV ? `, ${nV} Verteilung${nV === 1 ? "" : "en"}` : ""}${besch ? " · " + besch : ""}`,
        () => oeffneBauaufmass(b), b.gesendet);
    }
  }
  leer.hidden = !leer.textContent;
  window.scrollTo(0, 0);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function oeffneFormular(aufmass) {
  setzeAnsicht("detail");
  aktuellerBereich = "aufmass";
  currentAufmass = aufmass;
  currentPackliste = null;
  currentBauaufmass = null;
  currentRaum = null;
  zurueckAktion = null;
  selectedArtikel = null;
  selectedStandardArtikel = null;
  selectedFavoritArtikel = null;
  headerTitle.textContent = "Aufmaß";
  btnBack.hidden = false;
  btnNew.hidden = true;

  const tpl = document.getElementById("tpl-formular");
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));

  fuelleFormular();
  bindeFormularEvents();
  renderMaterialTabelle();
}

function fuelleFormular() {
  const a = currentAufmass;
  document.getElementById("f_kundeName").value = a.kunde.name;
  document.getElementById("f_ansprechpartner").value = a.kunde.ansprechpartner;
  document.getElementById("f_strasse").value = a.kunde.strasse;
  document.getElementById("f_plzOrt").value = a.kunde.plzOrt;
  document.getElementById("f_telefon").value = a.kunde.telefon;
  document.getElementById("f_baustelle").value = a.baustelle;
  document.getElementById("f_datum").value = a.datum;
  document.getElementById("f_arbeitsbeschreibung").value = a.arbeitsbeschreibung;
  const bestehend = aufmassListe.some((x) => x.id === a.id);
  document.getElementById("btnLoeschen").hidden = !bestehend;
}

function bindeFormularEvents() {
  const a = currentAufmass;

  const feldBindungen = [
    ["f_kundeName", () => a.kunde.name, (v) => (a.kunde.name = v)],
    ["f_ansprechpartner", () => a.kunde.ansprechpartner, (v) => (a.kunde.ansprechpartner = v)],
    ["f_strasse", () => a.kunde.strasse, (v) => (a.kunde.strasse = v)],
    ["f_plzOrt", () => a.kunde.plzOrt, (v) => (a.kunde.plzOrt = v)],
    ["f_telefon", () => a.kunde.telefon, (v) => (a.kunde.telefon = v)],
    ["f_baustelle", () => a.baustelle, (v) => (a.baustelle = v)],
    ["f_datum", () => a.datum, (v) => (a.datum = v)],
    ["f_arbeitsbeschreibung", () => a.arbeitsbeschreibung, (v) => (a.arbeitsbeschreibung = v)]
  ];
  for (const [id, , setter] of feldBindungen) {
    document.getElementById(id).addEventListener("input", (e) => {
      setter(e.target.value);
      autosave();
    });
  }

  klonMaterialTabs("materialHinzufuegenAufmass");
  bindeMaterialAuswahl(a.material, () => {
    renderMaterialTabelle();
    autosave();
  }, { diktat: true });
  // Aufmaßsoftware: Baustellen-Ordner auch im normalen Aufmaß
  const ordnerNeu = () => renderOrdnerAuswahl(a, "a_ordner", () => {
    aktualisiereAbgeleiteteListen();
    const q = document.getElementById("ms_suche");
    msRender(q ? q.value : "");
  });
  ordnerNeu();
  for (const id of ["f_kundeName", "f_baustelle"]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => { if (!a.ordner) ordnerNeu(); });
  }

  // Löschen / PDF
  document.getElementById("btnLoeschen").addEventListener("click", () => {
    if (!confirm("Dieses Aufmaß wirklich löschen?")) return;
    aufmassListe = aufmassListe.filter((x) => x.id !== a.id);
    speichereListe();
    verwerfeAktuellesOhneSpeichern();
    zeigeUebersicht();
  });

  document.getElementById("btnPdf").addEventListener("click", () => {
    if (!istLeeresAufmass(a)) upsertCurrentInListe();
    erstellePdf(a);
  });
  baueGesendetStatus(a, document.getElementById("btnPdf"), () => {
    if (currentAufmass === a && !istLeeresAufmass(a)) upsertCurrentInListe(); else speichereListe();
  });
}

/* Klont den wiederverwendbaren "Material hinzufügen"-Baustein (Tabs Aus
   Liste / Standardmaterial / Freitext) in den Platzhalter mit der
   übergebenen ID. Wird sowohl vom Aufmaß- als auch vom Packliste-Formular
   genutzt (immer nur eines davon gleichzeitig im DOM). */
function klonMaterialTabs(platzhalterId) {
  const tpl = document.getElementById("tpl-material-suche");
  const platzhalter = document.getElementById(platzhalterId);
  platzhalter.innerHTML = "";
  platzhalter.appendChild(tpl.content.cloneNode(true));
}


/* Erzeugt die Menge-Zelle mit Plus-/Minus-Buttons und (bei Einheit "m")
   dem Zusatzfeld zum Draufaddieren. `m` ist die mutierte Materialposition,
   `onChange` wird nach jeder Änderung aufgerufen (Autosave). Gemeinsam
   genutzt von der Aufmaß-Materialliste und der Packliste. */
// v18.4: LED-Stripes wahlweise in laufenden Metern oder Rollen
// v19.4: nur echte Stripes (Einheit m oder Rolle), kein Zubehör wie Treiber/Netzteil/Profil
const LED_ZUBEHOER = /treiber|netzteil|trafo|transformator|vorschaltger|konverter|converter|controller|steuer|dimmer|empf(ä|ae)nger|profil|abdeckung|diffusor|endkappe|kappe|halter|clip|klammer|verbinder|kupplung|einspeis|kabel|leitung|fernbedienung|sensor|schalter|taster|gateway|modul|aktor/i;
function istLedStripeMaterial(m) {
  const b = m.bezeichnung || "";
  const e = (m.einheit || "").trim().toLowerCase();
  if (!(e === "m" || e.startsWith("rolle") || /rolle/i.test(b))) return false;
  return /led[- ]?(stripe|strip|streifen|band)|lichtband/i.test(b) && !LED_ZUBEHOER.test(b);
}

function baueMengeZelle(m, onChange) {
  const td = document.createElement("td");
  td.className = "col-menge";
  const meterZeile = istMeterEinheit(m.einheit)
    ? `<div class="menge-add">
         <input type="number" step="any" min="0" placeholder="+ m" class="menge-add-input" inputmode="decimal">
         <button type="button" class="btn-qty-add">hinzufügen</button>
       </div>`
    : "";
  td.innerHTML = `
    <div class="menge-control">
      <button type="button" class="btn-qty" data-action="dec" aria-label="Menge verringern">−</button>
      <input type="number" step="any" min="0" value="${m.menge}" class="menge-input" inputmode="decimal">
      <button type="button" class="btn-qty" data-action="inc" aria-label="Menge erhöhen">+</button>
    </div>
    ${meterZeile}
  `;

  if (istLedStripeMaterial(m)) {
    const rollen = /^rolle/i.test((m.einheit || "").trim());
    const wahl = document.createElement("div");
    wahl.className = "einheit-wahl";
    wahl.innerHTML = `<button type="button" data-e="m" class="${rollen ? "" : "aktiv"}">m</button><button type="button" data-e="Rolle" class="${rollen ? "aktiv" : ""}">Rollen</button>`;
    wahl.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => {
      const neu = btn.dataset.e;
      if (neu === (rollen ? "Rolle" : "m")) return;
      m.einheit = neu;
      if (neu === "Rolle") m.menge = 1; // Meterwert passt nicht als Rollenanzahl
      onChange();
      // Einheit-Spalte (direkt rechts daneben) mitziehen
      const zelle = td.nextElementSibling;
      if (zelle && zelle.tagName === "TD" && !zelle.querySelector("button, input")) zelle.textContent = m.einheit;
      td.replaceWith(baueMengeZelle(m, onChange));
    }));
    td.appendChild(wahl);
  }

  const mengeInput = td.querySelector(".menge-input");
  mengeInput.addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    m.menge = isNaN(v) ? 0 : v;
    onChange();
  });

  td.querySelector('[data-action="dec"]').addEventListener("click", () => {
    m.menge = Math.max(0, rundeMenge(m.menge - 1));
    mengeInput.value = m.menge;
    onChange();
  });
  td.querySelector('[data-action="inc"]').addEventListener("click", () => {
    m.menge = rundeMenge(m.menge + 1);
    mengeInput.value = m.menge;
    onChange();
  });

  const addInput = td.querySelector(".menge-add-input");
  if (addInput) {
    const addBtn = td.querySelector(".btn-qty-add");
    const zusatzHinzufuegen = () => {
      const zusatz = parseFloat(addInput.value);
      if (!(zusatz > 0)) return;
      m.menge = rundeMenge(m.menge + zusatz);
      mengeInput.value = m.menge;
      addInput.value = "";
      onChange();
    };
    addBtn.addEventListener("click", zusatzHinzufuegen);
    addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); zusatzHinzufuegen(); }
    });
  }

  return td;
}

function renderMaterialTabelle() {
  const a = currentAufmass;
  const tbody = document.getElementById("materialTbody");
  const leerHinweis = document.getElementById("materialLeerHinweis");
  const anzahlEl = document.getElementById("anzahlPositionen");
  tbody.innerHTML = "";
  anzahlEl.textContent = a.material.length;

  if (a.material.length === 0) {
    leerHinweis.hidden = false;
    return;
  }
  leerHinweis.hidden = true;

  a.material.forEach((m) => {
    const tr = document.createElement("tr");

    const tdBez = document.createElement("td");
    const sub = m.quelle === "liste" && m.artikelnummer ? `<div class="row-sub">Art.-Nr. ${escapeHtml(m.artikelnummer)}</div>` : "";
    tdBez.innerHTML = `${escapeHtml(m.bezeichnung)}${sub}`;
    tr.appendChild(tdBez);

    tr.appendChild(baueMengeZelle(m, autosave));

    const tdEinheit = document.createElement("td");
    tdEinheit.textContent = m.einheit;
    tr.appendChild(tdEinheit);

    const tdDel = document.createElement("td");
    tdDel.className = "col-del";
    tdDel.innerHTML = `<button class="btn-danger-text" type="button">✕</button>`;
    tdDel.querySelector("button").addEventListener("click", () => {
      currentAufmass.material = currentAufmass.material.filter((x) => x.id !== m.id);
      renderMaterialTabelle();
      autosave();
    });
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  });
}

/* ---------- Packliste ---------- */

function oeffnePackliste(packliste) {
  setzeAnsicht("detail");
  aktuellerBereich = "packliste";
  currentPackliste = packliste;
  currentAufmass = null;
  currentBauaufmass = null;
  currentRaum = null;
  zurueckAktion = null;
  selectedArtikel = null;
  selectedStandardArtikel = null;
  selectedFavoritArtikel = null;
  headerTitle.textContent = "Packliste";
  btnBack.hidden = false;
  btnNew.hidden = true;

  const tpl = document.getElementById("tpl-packliste");
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));

  fuellePackliste();
  bindePacklisteEvents();
  renderPacklisteMaterial();
}

function fuellePackliste() {
  const p = currentPackliste;
  document.getElementById("p_bezeichnung").value = p.bezeichnung;
  document.getElementById("p_datum").value = p.datum;
  const bestehend = packlisten.some((x) => x.id === p.id);
  document.getElementById("btnPacklisteLoeschen").hidden = !bestehend;
}

function bindePacklisteEvents() {
  const p = currentPackliste;

  document.getElementById("p_bezeichnung").addEventListener("input", (e) => {
    p.bezeichnung = e.target.value;
    autosave();
  });
  document.getElementById("p_datum").addEventListener("input", (e) => {
    p.datum = e.target.value;
    autosave();
  });

  klonMaterialTabs("materialHinzufuegenPackliste");
  bindeMaterialAuswahl(p.material, () => {
    renderPacklisteMaterial();
    autosave();
  }, { diktat: true });

  document.getElementById("btnPacklisteLoeschen").addEventListener("click", () => {
    if (!confirm("Diese Packliste wirklich löschen?")) return;
    packlisten = packlisten.filter((x) => x.id !== p.id);
    speicherePacklisten();
    verwerfeAktuellesOhneSpeichern();
    zeigeUebersicht();
  });
}

function bauePacklisteZeile(m, istGepackt) {
  const tr = document.createElement("tr");
  if (istGepackt) tr.className = "zeile-gepackt";

  const tdCheck = document.createElement("td");
  tdCheck.className = "col-check";
  const checkBtn = document.createElement("button");
  checkBtn.type = "button";
  checkBtn.className = "check-btn" + (istGepackt ? " checked" : "");
  checkBtn.setAttribute("aria-label", istGepackt ? "Als noch zu packen markieren" : "Als gepackt markieren");
  checkBtn.textContent = "✓";
  checkBtn.addEventListener("click", () => {
    m.erledigt = !m.erledigt;
    renderPacklisteMaterial();
    autosave();
  });
  tdCheck.appendChild(checkBtn);
  tr.appendChild(tdCheck);

  const tdBez = document.createElement("td");
  const sub = m.quelle === "liste" && m.artikelnummer ? `<div class="row-sub">Art.-Nr. ${escapeHtml(m.artikelnummer)}</div>` : "";
  tdBez.innerHTML = `<span class="bez-text">${escapeHtml(m.bezeichnung)}</span>${sub}`;
  tr.appendChild(tdBez);

  tr.appendChild(baueMengeZelle(m, autosave));

  const tdEinheit = document.createElement("td");
  tdEinheit.textContent = m.einheit;
  tr.appendChild(tdEinheit);

  const tdDel = document.createElement("td");
  tdDel.className = "col-del";
  tdDel.innerHTML = `<button class="btn-danger-text" type="button">✕</button>`;
  tdDel.querySelector("button").addEventListener("click", () => {
    currentPackliste.material = currentPackliste.material.filter((x) => x.id !== m.id);
    renderPacklisteMaterial();
    autosave();
  });
  tr.appendChild(tdDel);

  return tr;
}

function renderPacklisteMaterial() {
  const p = currentPackliste;
  const offenTbody = document.getElementById("packlisteOffenTbody");
  const gepacktTbody = document.getElementById("packlisteGepacktTbody");
  const offenLeer = document.getElementById("packlisteOffenLeer");
  const anzahlOffen = document.getElementById("packlisteAnzahlOffen");
  const anzahlGepackt = document.getElementById("packlisteAnzahlGepackt");
  const gepacktDetails = document.getElementById("packlisteGepacktDetails");

  offenTbody.innerHTML = "";
  gepacktTbody.innerHTML = "";

  const offen = p.material.filter((m) => !m.erledigt);
  const gepackt = p.material.filter((m) => m.erledigt);

  anzahlOffen.textContent = offen.length;
  anzahlGepackt.textContent = gepackt.length;

  offenLeer.hidden = offen.length !== 0;
  gepacktDetails.hidden = gepackt.length === 0;

  offen.forEach((m) => offenTbody.appendChild(bauePacklisteZeile(m, false)));
  gepackt.forEach((m) => gepacktTbody.appendChild(bauePacklisteZeile(m, true)));
}

/* ---------- PDF-Export ---------- */

function dateiname(a) {
  const kunde = (a.kunde.name || "Aufmass").trim().replace(/[^a-zA-Z0-9äöüÄÖÜß _-]/g, "").replace(/\s+/g, "_");
  return `Aufmass_${kunde}_${heuteISO()}.pdf`; // aktuelles Datum (Export-Zeitpunkt), nicht das Aufmaß-Datum
}

function erstellePdf(a) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 14;
  let y = 18;

  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.text("Materialaufmaß", marginX, y);
  doc.setFont(undefined, "normal");
  doc.setFontSize(10);
  doc.text(`Datum: ${formatDatumDE(a.datum)}`, 210 - marginX, y, { align: "right" });
  y += 9;

  doc.setDrawColor(210);
  doc.line(marginX, y, 210 - marginX, y);
  y += 7;

  doc.setFontSize(11);
  doc.setFont(undefined, "bold");
  doc.text("Kunde", marginX, y);
  y += 5.5;
  doc.setFont(undefined, "normal");
  doc.setFontSize(10);
  const kundeZeilen = [];
  if (a.kunde.name.trim()) kundeZeilen.push(a.kunde.name.trim());
  if (a.kunde.ansprechpartner.trim()) kundeZeilen.push("z. Hd. " + a.kunde.ansprechpartner.trim());
  if (a.kunde.strasse.trim()) kundeZeilen.push(a.kunde.strasse.trim());
  if (a.kunde.plzOrt.trim()) kundeZeilen.push(a.kunde.plzOrt.trim());
  if (a.kunde.telefon.trim()) kundeZeilen.push("Tel. " + a.kunde.telefon.trim());
  if (kundeZeilen.length === 0) kundeZeilen.push("–");
  for (const zeile of kundeZeilen) {
    doc.text(zeile, marginX, y);
    y += 5;
  }

  if (a.baustelle.trim()) {
    y += 2;
    doc.setFont(undefined, "bold");
    doc.setFontSize(11);
    doc.text("Baustelle / Bauvorhaben", marginX, y);
    y += 5.5;
    doc.setFont(undefined, "normal");
    doc.setFontSize(10);
    const zeilen = doc.splitTextToSize(a.baustelle.trim(), 210 - marginX * 2);
    doc.text(zeilen, marginX, y);
    y += zeilen.length * 5;
  }

  if (a.arbeitsbeschreibung.trim()) {
    y += 2;
    doc.setFont(undefined, "bold");
    doc.setFontSize(11);
    doc.text("Arbeitsbeschreibung", marginX, y);
    y += 5.5;
    doc.setFont(undefined, "normal");
    doc.setFontSize(10);
    const zeilen = doc.splitTextToSize(a.arbeitsbeschreibung.trim(), 210 - marginX * 2);
    doc.text(zeilen, marginX, y);
    y += zeilen.length * 5;
  }

  y += 4;

  const head = [["Pos.", "Bezeichnung", "Art.-Nr.", "Menge", "Einh."]];

  const body = a.material.map((m, i) => [
    String(i + 1),
    m.bezeichnung,
    m.artikelnummer || "–",
    m.menge.toLocaleString("de-DE"),
    m.einheit
  ]);

  doc.autoTable({
    startY: y,
    head,
    body,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [21, 34, 56] },
    columnStyles: { 0: { cellWidth: 9 }, 3: { cellWidth: 18 }, 4: { cellWidth: 16 } },
    didDrawPage: () => {
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(
        `Seite ${doc.internal.getCurrentPageInfo().pageNumber} / ${pageCount}`,
        210 - marginX,
        297 - 8,
        { align: "right" }
      );
      doc.setTextColor(0);
    }
  });

  // v19.3: nach erfolgreichem Teilen automatisch als gesendet markieren
  gibPdfAus(doc, dateiname(a), () => {
    if (currentAufmass === a) upsertCurrentInListe();
    setzeGesendet(a, true);
    speichereListe();
    if (currentAufmass === a) aktualisiereGesendetStatus(a);
  });
}

/* ---------- Gesendet-Markierung (v19.3) ----------
   `gesendet`: ISO-Zeitpunkt oder fehlt. Wird beim Teilen des PDFs automatisch
   gesetzt und kann im Aufmaß/Bauaufmaß von Hand gesetzt/zurückgenommen werden. */
function setzeGesendet(obj, an) {
  if (an) obj.gesendet = new Date().toISOString();
  else delete obj.gesendet;
}

function formatZeitDE(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) + ", " +
    d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
}

// Statuszeile über den Aktionsknöpfen; `speichern` sichert das Objekt nach einer Änderung
let gesendetStatusEl = null;
let gesendetSpeichern = null;
function baueGesendetStatus(obj, ankerButton, speichern) {
  gesendetSpeichern = speichern;
  gesendetStatusEl = document.createElement("div");
  gesendetStatusEl.className = "gesendet-status";
  ankerButton.closest(".action-bar").before(gesendetStatusEl);
  aktualisiereGesendetStatus(obj);
}

function aktualisiereGesendetStatus(obj) {
  const el = gesendetStatusEl;
  if (!el || !document.body.contains(el)) return;
  el.innerHTML = "";
  el.classList.toggle("ist-gesendet", !!obj.gesendet);
  const text = document.createElement("span");
  text.textContent = obj.gesendet ? `✓ Gesendet am ${formatZeitDE(obj.gesendet)}` : "Noch nicht gesendet";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-link-accent";
  btn.textContent = obj.gesendet ? "zurücksetzen" : "✓ als gesendet markieren";
  btn.addEventListener("click", () => {
    setzeGesendet(obj, !obj.gesendet);
    if (gesendetSpeichern) gesendetSpeichern();
    aktualisiereGesendetStatus(obj);
  });
  el.append(text, btn);
}

/* v19.2: PDF ausgeben. Auf dem iPhone/iPad (und anderen Geräten mit Teilen-Funktion)
   öffnet sich direkt das Teilen-Menü mit genau EINER sauberen PDF-Datei
   (Mail, AirDrop, In Dateien sichern …) – ohne zusätzlichen Text, der in Mail
   sonst als zweiter Anhang auftaucht. Sonst normaler Download. */
function gibPdfAus(doc, name, onGeteilt) {
  let datei = null;
  try {
    const blob = doc.output("blob");
    datei = new File([blob], name, { type: "application/pdf" });
  } catch (e) { datei = null; }
  const mobil = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (datei && mobil && navigator.canShare && navigator.canShare({ files: [datei] })) {
    navigator.share({ files: [datei] }).then(() => { if (onGeteilt) onGeteilt(); }).catch((err) => {
      if (err && err.name === "AbortError") return; // abgebrochen
      doc.save(name);                                 // z. B. Geste abgelaufen -> Download
    });
    return;
  }
  doc.save(name);
}

/* ---------- Init ---------- */

// Zurück: eigenes Ziel (z. B. Raum -> Bauaufmaß), sonst Liste -> Start, Detail -> Liste
btnBack.addEventListener("click", () => {
  if (zurueckAktion) zurueckAktion();
  else if (ansicht === "liste") zeigeStart();
  else zeigeUebersicht();
});
btnNew.addEventListener("click", () => { if (aktuellerBereich) BEREICHE[aktuellerBereich].neu(); });

ladeListe();
ladePacklisten();
ladeBauaufmasse();
ladeFavoriten();
ladeSterne();
ladeDatenbank();
ladeMaterialDB();
zeigeStart();
initDatenbank(); // einmalige Übernahme von Standardmaterial, Produktliste und eigenen Artikeln

const btnScannerSchliessen = document.getElementById("btnScannerSchliessen");
if (btnScannerSchliessen) btnScannerSchliessen.addEventListener("click", schliesseBarcodeScanner);
const btnScannerAbbrechen = document.getElementById("btnScannerAbbrechen");
if (btnScannerAbbrechen) btnScannerAbbrechen.addEventListener("click", schliesseBarcodeScanner);

const scannerManuellBtn = document.getElementById("scannerManuellBtn");
const scannerManuellInput = document.getElementById("scannerManuellInput");
if (scannerManuellBtn) {
  scannerManuellBtn.addEventListener("click", barcodeManuellSuchen);
  scannerManuellInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); barcodeManuellSuchen(); }
  });
}

/* ---------- Service-Worker-Update ---------- */

function initServiceWorkerUpdate() {
  const banner = document.getElementById("updateBanner");
  const btnUpdate = document.getElementById("btnUpdate");
  let wartenderWorker = null;
  let updateAngefordert = false; // true erst NACH Klick auf "Jetzt aktualisieren"

  function zeigeUpdateBanner(worker) {
    wartenderWorker = worker;
    banner.hidden = false;
  }

  btnUpdate.addEventListener("click", () => {
    if (!wartenderWorker) return;
    updateAngefordert = true;
    wartenderWorker.postMessage({ type: "SKIP_WAITING" });
  });

  // "controllerchange" feuert auch beim allerersten Laden, sobald der erste
  // Service Worker die Seite übernimmt – das ist kein Update und darf NICHT
  // zu einem Neuladen führen. Nur neu laden, wenn der Nutzer zuvor aktiv im
  // Banner bestätigt hat.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!updateAngefordert) return;
    updateAngefordert = false;
    window.location.reload();
  });

  navigator.serviceWorker.register("sw.js").then((registration) => {
    // Fall 1: Beim Laden der Seite liegt bereits eine fertig installierte,
    // wartende Version vor (z. B. Tab war offen, während die neue Version
    // im Hintergrund heruntergeladen wurde).
    if (registration.waiting && navigator.serviceWorker.controller) {
      zeigeUpdateBanner(registration.waiting);
    }

    // Fall 2: Während die Seite offen ist, wird eine neue Version gefunden.
    registration.addEventListener("updatefound", () => {
      const neuerWorker = registration.installing;
      if (!neuerWorker) return;
      neuerWorker.addEventListener("statechange", () => {
        if (neuerWorker.state === "installed" && navigator.serviceWorker.controller) {
          zeigeUpdateBanner(neuerWorker);
        }
      });
    });

    // Aktiv nach einer neuen Version schauen, wenn die App wieder in den
    // Vordergrund kommt (z. B. nach dem Öffnen vom Homescreen).
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration.update();
    });
  }).catch((e) => console.error("SW-Registrierung fehlgeschlagen", e));
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", initServiceWorkerUpdate);
}
