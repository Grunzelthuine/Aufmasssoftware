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
    btn.innerHTML = ic("star");
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
let scannerStopp = Promise.resolve();   // v7.3: läuft noch ein Stopp vom letzten Öffnen?
let scannerLauf = 0;                    // zählt Öffnungen, damit alte Starts nichts mehr anfassen
const SCANNER_KAMERA_KEY = "am2_scanner_kamera"; // gewählte Rückkamera { id, label }

function scannerGespeicherteKamera() {
  try { return JSON.parse(localStorage.getItem(SCANNER_KAMERA_KEY) || "null"); } catch (e) { return null; }
}

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
  const lauf = ++scannerLauf;
  // Erst warten, bis ein evtl. noch laufender Stopp vom letzten Mal fertig ist – sonst räumt
  // dessen clear() das neue Kamerabild aus dem Fenster (Bild nur halb oben im Display).
  scannerStopp.then(() => { if (lauf === scannerLauf && !overlay.hidden) starteScannerKamera(onErgebnis, scannerGespeicherteKamera()); });
}

function starteScannerKamera(onErgebnis, kamera) {
  const hinweis = document.getElementById("scannerHinweis");
  const lauf = scannerLauf;
  // Jedes Mal ein frisches Element für das Kamerabild
  const reader = document.getElementById("scannerReader");
  reader.innerHTML = "";
  const ziel = document.createElement("div");
  ziel.id = "scannerReaderLauf" + lauf;
  reader.appendChild(ziel);

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
  const scanner = new Html5Qrcode(ziel.id, { formatsToSupport: formate, verbose: false });
  html5QrcodeScanner = scanner;

  // Etwas höhere Kamera-Auflösung anfordern, damit auch dünne Strichcode-
  // Balken (EAN/Code128) sauber aufgelöst werden. Breiterer, flacherer Scan-
  // Rahmen passend zur Form eines 1D-Barcodes statt eines Quadrats.
  // v7.3: gewählte Rückkamera (z. B. die mit Nahfokus) direkt benutzen.
  const videoConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  if (kamera && kamera.id) videoConstraints.deviceId = { exact: kamera.id };
  else videoConstraints.facingMode = "environment";
  const config = {
    fps: 12,
    qrbox: (w, h) => ({ width: Math.floor(Math.min(280, w * 0.85)), height: Math.floor(Math.min(130, h * 0.6)) }),
    aspectRatio: 1.7,
    videoConstraints
  };

  let erledigt = false;
  scanner
    .start(
      kamera && kamera.id ? { deviceId: { exact: kamera.id } } : { facingMode: "environment" },
      config,
      (decodedText) => {
        if (erledigt) return; // mehrere Treffer kurz hintereinander nur einmal auswerten
        erledigt = true;
        schliesseBarcodeScanner();
        onErgebnis(decodedText);
      },
      () => { /* laufender Frame ohne Treffer, kein Fehler */ }
    )
    .then(() => {
      if (lauf !== scannerLauf || html5QrcodeScanner !== scanner) return;
      const video = ziel.querySelector("video");
      if (video) { video.setAttribute("playsinline", ""); video.setAttribute("muted", ""); video.muted = true; }
      hinweis.textContent = "Barcode in den Rahmen halten – ruhig, gut ausgeleuchtet und nah heranhalten.";
      scannerLichtVorbereiten(video);
    })
    .catch((err) => {
      if (lauf !== scannerLauf) return;
      if (kamera && kamera.id) {
        // gespeicherte Kamera gibt es nicht (mehr) – mit der Standard-Rückkamera erneut versuchen
        try { localStorage.removeItem(SCANNER_KAMERA_KEY); } catch (e) { /* egal */ }
        html5QrcodeScanner = null;
        try { scanner.clear(); } catch (e) { /* egal */ }
        starteScannerKamera(onErgebnis, null);
        return;
      }
      hinweis.textContent = "Kamera konnte nicht gestartet werden (Berechtigung erteilt?).";
      console.error("Barcode-Scanner-Start fehlgeschlagen", err);
    });
}

/* ---------- v7.4: Taschenlampe im Scanner ----------
   Knopf erscheint nur, wenn die Kamera eine Lampe hat (track.getCapabilities().torch).
   Nach dem Scan bzw. beim Schließen geht die Lampe automatisch wieder aus. */
let scannerLichtTrack = null;

function scannerLichtVorbereiten(video) {
  const btn = document.getElementById("scannerLicht");
  if (!btn) return;
  scannerLichtTrack = null;
  btn.hidden = true;
  btn.classList.remove("aktiv");
  const track = video && video.srcObject && video.srcObject.getVideoTracks ? video.srcObject.getVideoTracks()[0] : null;
  let kann = false;
  try { kann = !!(track && track.getCapabilities && track.getCapabilities().torch); } catch (e) { kann = false; }
  if (!kann) return;
  scannerLichtTrack = track;
  btn.hidden = false;
  btn.querySelector("span").textContent = "Licht an";
}

function scannerLichtSetzen(an) {
  const btn = document.getElementById("scannerLicht");
  const track = scannerLichtTrack;
  if (!track || track.readyState !== "live") return Promise.resolve();
  return track.applyConstraints({ advanced: [{ torch: !!an }] }).then(() => {
    if (btn) { btn.classList.toggle("aktiv", !!an); btn.querySelector("span").textContent = an ? "Licht aus" : "Licht an"; }
  }).catch((e) => { console.warn("Taschenlampe nicht schaltbar", e); });
}

function scannerLichtUmschalten() {
  const btn = document.getElementById("scannerLicht");
  scannerLichtSetzen(!(btn && btn.classList.contains("aktiv")));
}

/* ---------- v7.4: Scanner-Kamera in den Einstellungen wählen ----------
   Die Wahl wird gemerkt (am2_scanner_kamera) und beim Scannen sofort benutzt. */
function renderScannerEinstellungen(host) {
  if (!host) return;
  host.innerHTML = `
    <details class="section-card scanner-einstellung">
      <summary><span class="ht ht-gray">${ic("camera")}</span><span>Barcode-Scanner</span></summary>
      <p class="hint">Kamera für den Scanner. Bei iPhones mit mehreren Linsen die wählen, die nah am schärfsten ist (bei Pro-Modellen meist die Ultraweitwinkelkamera).</p>
      <div class="chip-row sk-liste"></div>
      <button type="button" class="btn btn-secondary sk-laden">${ic("camera")}Kameras anzeigen</button>
      <p class="hint sk-info"></p>
    </details>`;
  const liste = host.querySelector(".sk-liste");
  const laden = host.querySelector(".sk-laden");
  const info = host.querySelector(".sk-info");
  const zeichne = (kameras) => {
    const gew = scannerGespeicherteKamera();
    liste.innerHTML = "";
    const knopf = (text, wert) => {
      const b = document.createElement("button");
      b.type = "button";
      const aktiv = wert ? !!(gew && gew.id === wert.id) : !gew;
      b.className = "chip" + (aktiv ? " chip-aktiv" : "");
      b.textContent = text;
      b.addEventListener("click", () => {
        try {
          if (wert) localStorage.setItem(SCANNER_KAMERA_KEY, JSON.stringify(wert));
          else localStorage.removeItem(SCANNER_KAMERA_KEY);
        } catch (e) { /* egal */ }
        zeichne(kameras);
      });
      liste.appendChild(b);
    };
    knopf("Automatisch", null);
    kameras.forEach((k, i) => knopf((k.label || `Kamera ${i + 1}`).replace(/^(Rückseitige|Back)\s*/i, "") || `Kamera ${i + 1}`, { id: k.id, label: k.label || "" }));
    if (gew && !kameras.some((k) => k.id === gew.id)) info.textContent = `Gewählt: ${gew.label || "gespeicherte Kamera"}`;
    else info.textContent = "";
  };
  const rueckkameras = (geraete) => (geraete || []).filter((d) => d.kind === "videoinput" && !/front|vorder|facetime|user/i.test(d.label || "")).map((d) => ({ id: d.deviceId, label: d.label }));
  const holeListe = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) { info.textContent = "Dieses Gerät kann keine Kameraliste liefern."; return; }
    let geraete = await navigator.mediaDevices.enumerateDevices();
    // Namen gibt es erst nach erteilter Kamera-Erlaubnis: dann kurz eine Kamera öffnen und gleich wieder schließen
    if (!geraete.some((d) => d.kind === "videoinput" && d.label)) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      stream.getTracks().forEach((t) => t.stop());
      geraete = await navigator.mediaDevices.enumerateDevices();
    }
    const k = rueckkameras(geraete);
    laden.hidden = true;
    zeichne(k);
    if (k.length < 2) info.textContent = "Nur eine Rückkamera gefunden – „Automatisch“ passt.";
  };
  laden.addEventListener("click", () => {
    info.textContent = "Kameras werden gesucht…";
    holeListe().catch(() => { info.textContent = "Kamera nicht erlaubt oder nicht verfügbar."; });
  });
  // Ist die Erlaubnis schon da, Liste gleich zeigen
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    navigator.mediaDevices.enumerateDevices().then((g) => {
      if (g.some((d) => d.kind === "videoinput" && d.label)) { laden.hidden = true; zeichne(rueckkameras(g)); }
      else zeichne([]);
    }).catch(() => zeichne([]));
  } else zeichne([]);
}

function schliesseBarcodeScanner() {
  const overlay = document.getElementById("scannerOverlay");
  // v15: Overlay zuerst schließen – stop() wirft sofort einen Fehler, wenn die
  // Kamera gar nicht gestartet war (z. B. keine Berechtigung). Vorher blieb
  // das Overlay dann offen und „Schließen“ schien nicht zu funktionieren.
  overlay.hidden = true;
  barcodeScanErgebnisCallback = null;
  scannerLauf++;
  // v7.4: Taschenlampe aus, bevor die Kamera gestoppt wird
  const licht = scannerLichtSetzen(false);
  scannerLichtTrack = null;
  const lichtBtn = document.getElementById("scannerLicht");
  if (lichtBtn) { lichtBtn.hidden = true; lichtBtn.classList.remove("aktiv"); }
  if (html5QrcodeScanner) {
    const scanner = html5QrcodeScanner;
    html5QrcodeScanner = null;
    // v7.3: Stopp merken – das nächste Öffnen wartet darauf
    scannerStopp = licht
      .then(() => scanner.stop())
      .then(() => { try { scanner.clear(); } catch (e) { /* egal */ } })
      .catch(() => { try { scanner.clear(); } catch (e) { /* egal */ } });
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

// v7.3: Position IM BESTEHENDEN Array entfernen. Vorher wurde per filter() ein neues
// Array zugewiesen – die Materialsuche (msZustand) schrieb danach weiter in das alte
// Array, neu hinzugefügtes/gescanntes Material tauchte dann nicht mehr in der Liste auf.
function entferneMaterialZeile(liste, id) {
  for (let i = liste.length - 1; i >= 0; i--) if (liste[i].id === id) liste.splice(i, 1);
}

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

// Großhandelskatalog (~125 MB) liegt im eigenen Repo unter materials-chunks/.
// Alternativ kann auf einem Gerät ein selbst eingelesener DATANORM-Katalog verwendet werden
// (Einstellungen → Großhandelskatalog, gespeichert im Cache „am2-katalog-lokal“).
const KATALOG_BASIS = "materials-chunks/";
const KATALOG_LOKAL_CACHE = "am2-katalog-lokal";
const KATALOG_LOKAL_KEY = "am2_katalog_lokal";
let materialDBManifest = null; // { version, count, chunks, quelle: "server" | "lokal", … }
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
    let lokal = null;
    try { lokal = JSON.parse(localStorage.getItem(KATALOG_LOKAL_KEY) || "null"); } catch (e) { lokal = null; }
    let manifest, holeChunk;
    if (lokal && lokal.chunks && "caches" in window) {
      // selbst eingelesener DATANORM-Katalog auf diesem Gerät
      manifest = { ...lokal, quelle: "lokal" };
      const cache = await caches.open(KATALOG_LOKAL_CACHE);
      holeChunk = async (datei) => {
        const r = await cache.match("lokal/" + datei);
        if (!r) throw new Error(datei + ": im Gerätespeicher nicht gefunden – Katalog bitte neu einlesen");
        return r;
      };
    } else {
      const manifestRes = await fetch(KATALOG_BASIS + "materials-manifest.json", { cache: "no-cache" })
        .catch(() => fetch(KATALOG_BASIS + "materials-manifest.json"));
      if (!manifestRes.ok) throw new Error("Manifest: HTTP " + manifestRes.status);
      manifest = { ...(await manifestRes.json()), quelle: "server" };
      holeChunk = (datei) => fetch(`${KATALOG_BASIS}${datei}?v=${encodeURIComponent(manifest.version || "")}`);
    }
    materialDBManifest = manifest;
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
        const res = await holeChunk(datei);
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
    if (manifest.quelle === "server") raeumeAltenKatalogCacheAuf(manifest.version);
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
    const cache = await caches.open("am2-katalog");
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
  aufmass: { titel: "Aufmaße", einzeln: "Aufmaß", icon: "clipboard", neu: () => oeffneFormular(neuesAufmass()) },
  bau: { titel: "Bauaufmaße", einzeln: "Bauaufmaß", icon: "home", neu: () => oeffneBauaufmass(neuesBauaufmass()) },
  packliste: { titel: "Packlisten", einzeln: "Packliste", icon: "package", neu: () => oeffnePackliste(neuePackliste()) }
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
  if (typeof kundenstammErfassen === "function") {
    if (currentAufmass) kundenstammErfassen(currentAufmass.kunde);
    if (currentBauaufmass) kundenstammErfassen(currentBauaufmass.kunde);
  }
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

// Kachel (Startseite und Einstellungen)
function baueKachel(icon, titel, info, onClick, klasse) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "kachel " + (klasse || "");
  // icon: "name farbe" aus dem Speckmann-Symbolsatz, z. B. "clipboard orange"
  const [iconName, iconFarbe] = String(icon).split(" ");
  b.innerHTML = `<span class="kachel-icon ht ht-${iconFarbe || "gray"}">${ic(iconName)}</span><span class="kachel-text"><strong></strong><small></small></span><span class="chevron">${ic("right")}</span>`;
  b.querySelector("strong").textContent = titel;
  b.querySelector("small").textContent = info;
  b.addEventListener("click", onClick);
  return b;
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
  const anz = (n, s, p) => `${n} ${n === 1 ? s : p}`;
  const gross = "kachel-gross";
  view.appendChild(baueKachel("clipboard orange", "Aufmaß", anz(aufmassListe.length, "Aufmaß", "Aufmaße") + " · Material je Baustelle", () => { aktuellerBereich = "aufmass"; zeigeUebersicht(); }, gross));
  view.appendChild(baueKachel("home orange", "Bauaufmaß", anz(bauaufmasse.length, "Bauaufmaß", "Bauaufmaße") + " · Etagen, Räume, Verteilung", () => { aktuellerBereich = "bau"; zeigeUebersicht(); }, gross));
  view.appendChild(baueKachel("package blue", "Packliste", anz(packlisten.length, "Packliste", "Packlisten") + (bulliAnzahlOffen() ? ` · Bulli: ${bulliAnzahlOffen()} nachzuladen` : " · Abhaken beim Einladen"), () => { aktuellerBereich = "packliste"; zeigeUebersicht(); }, gross));
  const ma = typeof mitarbeiterName === "function" ? mitarbeiterName() : "";
  const einst = document.createElement("button");
  einst.type = "button";
  einst.className = "einstellung-knopf" + (ma ? "" : " kachel-hinweis");
  einst.innerHTML = `<span class="ht ht-gray">${ic("settings")}</span><span>${ma ? "Einstellungen" : "Einstellungen – Mitarbeitername fehlt"}</span>`;
  einst.addEventListener("click", () => oeffneEinstellungen());
  view.appendChild(einst);
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
  neu.innerHTML = `${ic("plus")}<span>Neues ${bereich.einzeln}</span>`;
  if (aktuellerBereich === "packliste") neu.innerHTML = `${ic("plus")}<span>Neue Packliste</span>`;
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
    det.innerHTML = `<summary>${ic("check")}<span>Bereits gesendet (<span class="gesendet-anzahl">0</span>)</span></summary>`;
    ulGesendet = document.createElement("ul");
    ulGesendet.className = "card-list";
    det.appendChild(ulGesendet);
    leer.before(det);
    return ulGesendet;
  };
  const karte = (titel, meta, onClick, gesendet) => {
    const li = document.createElement("li");
    li.className = "aufmass-card" + (gesendet ? " gesendet" : "");
    li.innerHTML = `<div class="info"><p class="kunde"></p><p class="meta"></p></div><span class="chevron">${ic("right")}</span>`;
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
      karte((a.nummer ? a.nummer + " · " : "") + (a.kunde.name.trim() || "(ohne Kundenname)"), `${formatDatumDE(a.datum)} · ${n} Position${n === 1 ? "" : "en"}${besch ? " · " + besch : ""}`, () => oeffneFormular(a), a.gesendet);
    }
  } else if (aktuellerBereich === "packliste") {
    leer.textContent = packlisten.length ? "" : "Noch keine Packliste angelegt.";
    // feste Packliste „Bulli auffüllen“ immer ganz oben
    const nBulli = bulliAnzahlOffen();
    karte("Bulli auffüllen", nBulli ? `${nBulli} Position${nBulli === 1 ? "" : "en"} nachzuladen · aus Aufmaßen` : "Nichts nachzuladen · füllt sich aus Aufmaßen", zeigeBulliPackliste);
    const bulliKarte = ul.lastElementChild;
    bulliKarte.classList.add("bulli-karte");
    bulliKarte.insertAdjacentHTML("afterbegin", `<span class="ht ht-orange">${ic("truck")}</span>`);
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
      karte((b.nummer ? b.nummer + " · " : "") + (b.kunde.name.trim() || "(ohne Kundenname)"),
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

  if (typeof bindeKundenstamm === "function") {
    bindeKundenstamm({ name: "f_kundeName", ansprechpartner: "f_ansprechpartner", strasse: "f_strasse", plzOrt: "f_plzOrt", telefon: "f_telefon" }, a.kunde);
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
    if (typeof kundenstammErfassen === "function") kundenstammErfassen(a.kunde);
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
      <button type="button" class="btn-qty" data-action="dec" aria-label="Menge verringern">${ic("minus")}</button>
      <input type="number" step="any" min="0" value="${m.menge}" class="menge-input" inputmode="decimal">
      <button type="button" class="btn-qty" data-action="inc" aria-label="Menge erhöhen">${ic("plus")}</button>
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

    // v7.8: Bulli- und Löschknopf direkt unter der Menge (keine eigene Spalte mehr -> nicht breiter als das Fenster)
    const tdMenge = baueMengeZelle(m, autosave);
    tr.appendChild(tdMenge);

    const tdEinheit = document.createElement("td");
    tdEinheit.textContent = m.einheit;
    tr.appendChild(tdEinheit);

    const tdDel = document.createElement("div");
    tdDel.className = "zeile-aktionen";
    tdDel.innerHTML = `<button class="bulli-btn${m.bulli ? " aktiv" : ""}" type="button" aria-pressed="${m.bulli ? "true" : "false"}" aria-label="${m.bulli ? "Nicht aus dem Bulli" : "Aus dem Bulli genommen"}">${ic("truck")}</button><button class="btn-danger-text" type="button" aria-label="Entfernen">${ic("trash")}</button>`;
    tdDel.querySelector(".bulli-btn").addEventListener("click", () => {
      setzeBulli(m, !m.bulli);
      renderMaterialTabelle();
      autosave();
    });
    tdDel.querySelector(".btn-danger-text").addEventListener("click", () => {
      entferneMaterialZeile(currentAufmass.material, m.id);
      renderMaterialTabelle();
      autosave();
    });
    tdMenge.appendChild(tdDel);

    tbody.appendChild(tr);
  });
}

/* ---------- Bulli auffüllen ----------
   Positionen eines Aufmaßes mit `bulli: true` wurden aus dem Bulli genommen.
   Die Packliste „Bulli auffüllen“ wird jedes Mal neu aus allen Aufmaßen
   berechnet (gleiche Artikel zusammengezählt). Was schon wieder eingeladen
   ist, steht an der Materialzeile selbst:
   - bulliGepackt: eingeladene Menge (Menge später erhöht -> Rest wieder offen)
   - bulliAusgeblendet: Teil davon, der aus „Bereits gepackt“ entfernt wurde
   Die Markierung erscheint nicht im PDF. Daten sind je Konto getrennt
   (Cloud-Sync pro Mitarbeiter), also sieht jeder nur seinen Bulli. */

function setzeBulli(m, an) {
  if (an) m.bulli = true;
  else { m.bulli = false; delete m.bulliGepackt; delete m.bulliAusgeblendet; }
}

function bulliSchluessel(m) {
  const e = (m.einheit || "").trim().toLowerCase();
  return m.artikelnummer ? "nr:" + m.artikelnummer + "|" + e : "b:" + (m.bezeichnung || "").trim().toLowerCase() + "|" + e;
}

function bulliPositionen() {
  const map = new Map();
  for (const a of aufmassListe) {
    for (const m of a.material || []) {
      if (!m.bulli) continue;
      const menge = Number(m.menge) || 0;
      const gepacktGesamt = Math.min(menge, Number(m.bulliGepackt) || 0);
      const offen = rundeMenge(menge - gepacktGesamt);
      const gepackt = rundeMenge(Math.max(0, gepacktGesamt - (Number(m.bulliAusgeblendet) || 0)));
      if (offen <= 0 && gepackt <= 0) continue;
      const key = bulliSchluessel(m);
      let p = map.get(key);
      if (!p) { p = { key, bezeichnung: m.bezeichnung, artikelnummer: m.artikelnummer || "", einheit: m.einheit, offen: 0, gepackt: 0, zeilen: [] }; map.set(key, p); }
      p.offen = rundeMenge(p.offen + offen);
      p.gepackt = rundeMenge(p.gepackt + gepackt);
      p.zeilen.push({ a, m, offen, gepackt });
    }
  }
  return [...map.values()].sort((x, y) => x.bezeichnung.localeCompare(y.bezeichnung, "de"));
}

function bulliAnzahlOffen() {
  return bulliPositionen().filter((p) => p.offen > 0).length;
}

function bulliHerkunftText(zeilen, feld) {
  return zeilen.filter((z) => z[feld] > 0).map((z) => {
    const name = (z.a.nummer ? z.a.nummer + " " : "") + (z.a.kunde.name.trim() || "(ohne Kunde)");
    return `${name} (${z[feld].toLocaleString("de-DE")})`;
  }).join(", ");
}

function zeigeBulliPackliste() {
  schliesseOffeneEintraege();
  setzeAnsicht("detail");
  aktuellerBereich = "packliste";
  headerTitle.textContent = "Bulli auffüllen";
  btnBack.hidden = false;
  btnNew.hidden = true;
  app.innerHTML = "";
  const view = document.createElement("section");
  view.className = "view";
  const tabelle = (id) => `<div class="table-scroll"><table><thead><tr><th></th><th>Bezeichnung</th><th>Menge</th><th>Einh.</th></tr></thead><tbody id="${id}"></tbody></table></div>`;
  view.innerHTML = `
    <p class="hint bulli-hinweis">${ic("truck")}<span>Material, das du in Aufmaßen als „aus dem Bulli“ markiert hast. Abhaken, wenn es wieder eingeladen ist.</span></p>
    <details class="section-card" open>
      <summary><span class="ht ht-ink">${ic("list")}</span><span>Noch einzuladen (<span id="bulliAnzahlOffen">0</span>)</span></summary>
      ${tabelle("bulliOffenTbody")}
      <p id="bulliOffenLeer" class="hint" hidden>Der Bulli ist voll – nichts nachzuladen.</p>
    </details>
    <details class="section-card" id="bulliGepacktDetails">
      <summary><span class="ht ht-green">${ic("check")}</span><span>Bereits eingeladen (<span id="bulliAnzahlGepackt">0</span>)</span></summary>
      ${tabelle("bulliGepacktTbody")}
      <button type="button" class="btn btn-secondary" id="btnBulliLeeren">${ic("trash")}Eingeladene ausblenden</button>
    </details>`;
  app.appendChild(view);
  view.querySelector("#btnBulliLeeren").addEventListener("click", () => {
    for (const a of aufmassListe) for (const m of a.material || []) {
      if (m.bulli && m.bulliGepackt) m.bulliAusgeblendet = Math.min(Number(m.menge) || 0, m.bulliGepackt);
    }
    speichereListe();
    renderBulliPackliste();
  });
  renderBulliPackliste();
  window.scrollTo(0, 0);
}

function renderBulliPackliste() {
  const offenTbody = document.getElementById("bulliOffenTbody");
  const gepacktTbody = document.getElementById("bulliGepacktTbody");
  if (!offenTbody || !gepacktTbody) return;
  const positionen = bulliPositionen();
  const offen = positionen.filter((p) => p.offen > 0);
  const gepackt = positionen.filter((p) => p.gepackt > 0);
  offenTbody.innerHTML = "";
  gepacktTbody.innerHTML = "";
  document.getElementById("bulliAnzahlOffen").textContent = offen.length;
  document.getElementById("bulliAnzahlGepackt").textContent = gepackt.length;
  document.getElementById("bulliOffenLeer").hidden = offen.length !== 0;
  document.getElementById("bulliGepacktDetails").hidden = gepackt.length === 0;

  const zeile = (p, istGepackt) => {
    const tr = document.createElement("tr");
    if (istGepackt) tr.className = "zeile-gepackt";
    const tdCheck = document.createElement("td");
    tdCheck.className = "col-check";
    tdCheck.innerHTML = `<button type="button" class="check-btn${istGepackt ? " checked" : ""}" aria-label="${istGepackt ? "Wieder als offen markieren" : "Als eingeladen markieren"}">${ic("check")}</button>`;
    tdCheck.querySelector("button").addEventListener("click", () => {
      for (const z of p.zeilen) {
        if (istGepackt) { if (z.gepackt > 0) z.m.bulliGepackt = Number(z.m.bulliAusgeblendet) || 0; }
        else if (z.offen > 0) z.m.bulliGepackt = Number(z.m.menge) || 0;
        if (!z.m.bulliGepackt) delete z.m.bulliGepackt;
      }
      speichereListe();
      renderBulliPackliste();
    });
    tr.appendChild(tdCheck);
    const tdBez = document.createElement("td");
    const nr = p.artikelnummer ? `<div class="row-sub">Art.-Nr. ${escapeHtml(p.artikelnummer)}</div>` : "";
    const herkunft = bulliHerkunftText(p.zeilen, istGepackt ? "gepackt" : "offen");
    tdBez.innerHTML = `<span class="bez-text">${escapeHtml(p.bezeichnung)}</span>${nr}${herkunft ? `<div class="row-sub">aus: ${escapeHtml(herkunft)}</div>` : ""}`;
    tr.appendChild(tdBez);
    const tdMenge = document.createElement("td");
    tdMenge.className = "col-menge bulli-menge";
    tdMenge.textContent = (istGepackt ? p.gepackt : p.offen).toLocaleString("de-DE");
    tr.appendChild(tdMenge);
    const tdE = document.createElement("td");
    tdE.textContent = p.einheit;
    tr.appendChild(tdE);
    return tr;
  };
  offen.forEach((p) => offenTbody.appendChild(zeile(p, false)));
  gepackt.forEach((p) => gepacktTbody.appendChild(zeile(p, true)));
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
  checkBtn.innerHTML = ic("check");
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
  tdDel.innerHTML = `<button class="btn-danger-text" type="button" aria-label="Entfernen">${ic("trash")}</button>`;
  tdDel.querySelector("button").addEventListener("click", () => {
    entferneMaterialZeile(currentPackliste.material, m.id);
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
  return `Aufmass_${a.nummer ? a.nummer + "_" : ""}${kunde}_${heuteISO()}.pdf`; // aktuelles Datum (Export-Zeitpunkt), nicht das Aufmaß-Datum
}

function erstellePdf(a) {
  // Aufmaßsoftware: Nummer beim ersten PDF vergeben (fragt ggf. einmalig den Mitarbeiternamen ab)
  if (!vergibNummer(a)) return;
  if (currentAufmass === a) upsertCurrentInListe(); else speichereListe();
  if (currentAufmass === a) aktualisiereGesendetStatus(a);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 14;
  let y = 20;

  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.text("Materialaufmaß", marginX, y);
  doc.setFont(undefined, "normal");
  pdfKopfRechts(doc, a, `Datum: ${formatDatumDE(a.datum)}`, marginX, y);
  y += 11;

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
      doc.text([`Aufmaß ${a.nummer || ""}`, pdfMitarbeiter(a)].filter((x) => x.trim()).join(" · "), marginX, 297 - 8);
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
  const nr = obj.nummer ? `Nr. ${obj.nummer} · ` : "";
  text.textContent = nr + (obj.gesendet ? `✓ Gesendet am ${formatZeitDE(obj.gesendet)}` : (obj.nummer ? "noch nicht gesendet" : "Nummer wird beim ersten PDF vergeben"));
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
const btnScannerLicht = document.getElementById("scannerLicht");
if (btnScannerLicht) btnScannerLicht.addEventListener("click", scannerLichtUmschalten);
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
  // Seit v6.2: Der Service Worker holt App-Dateien zuerst online und aktiviert neue Versionen sofort
  // (skipWaiting). Sobald eine neue Version die Seite übernimmt, werden offene Eingaben gespeichert
  // und die Seite einmal neu geladen – kein Banner, kein Antippen nötig.
  const hatteController = !!navigator.serviceWorker.controller; // false beim allerersten Start (kein Update)
  let neuGeladen = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hatteController || neuGeladen) return;
    neuGeladen = true;
    try { schliesseOffeneEintraege(); } catch (e) { console.error(e); }
    window.location.reload();
  });

  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((registration) => {
    registration.update().catch(() => {});
    // Bei jedem Zurückkehren in die App sowie regelmäßig nach einer neuen Version schauen
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration.update().catch(() => {});
    });
    setInterval(() => { if (navigator.onLine) registration.update().catch(() => {}); }, 5 * 60 * 1000);
  }).catch((e) => console.error("SW-Registrierung fehlgeschlagen", e));
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", initServiceWorkerUpdate);
}
