"use strict";

/* ============================================================
   Aufmaßsoftware – Großhandelskatalog (DATANORM) in den Einstellungen
   - Zeigt den aktuell geladenen Katalog (Server oder Gerät).
   - DATANORM-4-Datei einlesen (auch als ZIP), direkt im Browser:
     A-Sätze → Artikelnummer, Kurztext 1+2, Einheit; B-Sätze → EAN.
     (gleiche Logik wie tools/datanorm_to_json.py)
   - Ergebnis „auf diesem Gerät verwenden“ (Cache am2-katalog-lokal) oder
     als materials-chunks.zip für das GitHub-Repo herunterladen, damit alle
     Geräte den neuen Katalog bekommen.
   Wird nach app.js / mitarbeiter.js geladen.
   ============================================================ */

const KATALOG_ARTIKEL_PRO_CHUNK = 150000;
const CP850_OBEN = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";

let katalogImport = null; // { artikel, mitEan, quelle, version, chunks: [arrays] }

/* ---------- Zeichensatz ---------- */

function erkenneZeichensatz(bytes) {
  const probe = bytes.subarray(0, Math.min(bytes.length, 2000000));
  try { new TextDecoder("utf-8", { fatal: true }).decode(probe.subarray(0, probe.length - 4)); return "utf-8"; } catch (e) { /* kein UTF-8 */ }
  let cp = 0, win = 0;
  for (let i = 0; i < probe.length; i++) {
    const b = probe[i];
    if (b === 0x81 || b === 0x84 || b === 0x94 || b === 0xE1 || b === 0x8E || b === 0x99 || b === 0x9A) cp++;
    else if (b === 0xFC || b === 0xE4 || b === 0xF6 || b === 0xDF || b === 0xC4 || b === 0xD6 || b === 0xDC) win++;
  }
  return win > cp ? "windows-1252" : "cp850";
}

function dekodierer(zeichensatz) {
  if (zeichensatz !== "cp850") {
    const td = new TextDecoder(zeichensatz);
    return (bytes) => td.decode(bytes);
  }
  return (bytes) => {
    let s = "";
    const teil = 8192;
    for (let i = 0; i < bytes.length; i += teil) {
      const stueck = bytes.subarray(i, i + teil);
      let t = "";
      for (let j = 0; j < stueck.length; j++) {
        const b = stueck[j];
        t += b < 128 ? String.fromCharCode(b) : CP850_OBEN[b - 128];
      }
      s += t;
    }
    return s;
  };
}

/* ---------- DATANORM einlesen ---------- */

function istEanWert(w) { return /^\d{8,14}$/.test(w); }

// Liest die Bytes zeilenweise (ohne die ganze Datei als einen String zu halten)
function werteDatanormAus(bytes, zeichensatz, ziel) {
  const dek = dekodierer(zeichensatz);
  const block = 4 * 1024 * 1024;
  let rest = "";
  for (let pos = 0; pos < bytes.length; pos += block) {
    let ende = Math.min(bytes.length, pos + block);
    const text = rest + dek(bytes.subarray(pos, ende));
    const zeilen = text.split(/\r?\n/);
    rest = zeilen.pop();
    for (const z of zeilen) werteZeileAus(z, ziel);
  }
  if (rest) werteZeileAus(rest, ziel);
}

function werteZeileAus(zeile, ziel) {
  const art = zeile.charCodeAt(0);
  if (art === 66) { // "B"
    const p = zeile.split(";");
    if (p.length >= 10) {
      const nr = p[2].trim(), ean = p[9].trim();
      if (nr && istEanWert(ean)) ziel.eans.set(nr, ean);
    }
    return;
  }
  if (art !== 65) return; // "A"
  const p = zeile.split(";");
  if (p.length < 9) return;
  const nr = p[2].trim();
  const t1 = p[4].trim(), t2 = p[5].trim();
  const b = (t1 + (t2 ? " " + t2 : "")).trim();
  if (!nr || !b) return;
  ziel.artikel.push({ n: nr, b, e: p[8].trim() || "ST" });
}

// laufender 53-bit-Hash als Katalog-Version
function katalogHash(artikel) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (const a of artikel) {
    const s = a.n + "\u001f" + a.b + "\u001f" + a.e + "\u001f" + (a.g || "") + "\n";
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

function ladeJsZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((ok, fehler) => {
    const s = document.createElement("script");
    s.src = "vendor/jszip.min.js";
    s.onload = () => ok(window.JSZip);
    s.onerror = () => fehler(new Error("ZIP-Bibliothek konnte nicht geladen werden"));
    document.head.appendChild(s);
  });
}

async function leseDatanormDatei(datei, zeichensatzWahl, status) {
  const ziel = { artikel: [], eans: new Map() };
  let quellen = [];
  const anfang = new Uint8Array(await datei.slice(0, 4).arrayBuffer());
  const istZip = anfang[0] === 0x50 && anfang[1] === 0x4b;
  if (istZip) {
    status("ZIP wird entpackt …");
    const JSZip = await ladeJsZip();
    const zip = await JSZip.loadAsync(datei);
    const namen = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    // Hauptdateien (DATANORM.001 …); Preis-/Rabatt-/Warengruppendateien auslassen
    let haupt = namen.filter((n) => /datanorm\.\d{3}$/i.test(n.split("/").pop()));
    if (!haupt.length) haupt = namen.filter((n) => /\.\d{3}$/.test(n) && !/(datpreis|datrabatt|datnorm\.wrg|\.wrg|\.rab)/i.test(n));
    if (!haupt.length) throw new Error("Im ZIP wurde keine DATANORM-Hauptdatei (z. B. DATANORM.001) gefunden.");
    haupt.sort();
    for (const n of haupt) quellen.push({ name: n, holen: () => zip.files[n].async("uint8array") });
  } else {
    quellen.push({ name: datei.name, holen: async () => new Uint8Array(await datei.arrayBuffer()) });
  }
  let zs = zeichensatzWahl;
  for (let i = 0; i < quellen.length; i++) {
    status(`Lese ${quellen[i].name} (${i + 1} von ${quellen.length}) …`);
    await new Promise((r) => setTimeout(r, 30));
    const bytes = await quellen[i].holen();
    if (zs === "auto") zs = erkenneZeichensatz(bytes);
    werteDatanormAus(bytes, zs, ziel);
  }
  status("Artikel werden aufbereitet …");
  await new Promise((r) => setTimeout(r, 30));
  let mitEan = 0;
  for (const a of ziel.artikel) {
    const g = ziel.eans.get(a.n);
    if (g) { a.g = g; mitEan++; }
  }
  const chunks = [];
  for (let i = 0; i < ziel.artikel.length; i += KATALOG_ARTIKEL_PRO_CHUNK) chunks.push(ziel.artikel.slice(i, i + KATALOG_ARTIKEL_PRO_CHUNK));
  return {
    anzahl: ziel.artikel.length, mitEan, quelle: datei.name, zeichensatz: zs,
    version: katalogHash(ziel.artikel), chunks
  };
}

function chunkName(i) { return `materials-chunk-${String(i + 1).padStart(4, "0")}.json`; }

function importManifest(imp) {
  return { version: imp.version, count: imp.anzahl, chunks: imp.chunks.map((_, i) => chunkName(i)) };
}

// Auf diesem Gerät verwenden: Chunks in den Cache, Manifest in localStorage, Katalog neu laden
async function verwendeKatalogLokal(imp, status) {
  const cache = await caches.open(KATALOG_LOKAL_CACHE);
  for (const k of await cache.keys()) await cache.delete(k);
  for (let i = 0; i < imp.chunks.length; i++) {
    status(`Speichere Teil ${i + 1} von ${imp.chunks.length} …`);
    await cache.put("lokal/" + chunkName(i), new Response(JSON.stringify(imp.chunks[i]), { headers: { "Content-Type": "application/json" } }));
  }
  localStorage.setItem(KATALOG_LOKAL_KEY, JSON.stringify({ ...importManifest(imp), datum: new Date().toISOString(), datei: imp.quelle }));
  await ladeKatalogNeu();
}

async function entferneLokalenKatalog() {
  localStorage.removeItem(KATALOG_LOKAL_KEY);
  try { await caches.delete(KATALOG_LOKAL_CACHE); } catch (e) { /* egal */ }
  await ladeKatalogNeu();
}

async function ladeKatalogNeu() {
  materialDB = [];
  materialDBReady = false;
  materialDBManifest = null;
  materialDBStatus = "Materialliste wird geladen…";
  await ladeMaterialDB();
}

// ZIP mit materials-chunks/ (Manifest + Chunks) zum Hochladen ins GitHub-Repo
async function ladeKatalogZipHerunter(imp, status) {
  status("ZIP wird erstellt …");
  const JSZip = await ladeJsZip();
  const zip = new JSZip();
  const ordner = zip.folder("materials-chunks");
  ordner.file("materials-manifest.json", JSON.stringify(importManifest(imp), null, 2));
  imp.chunks.forEach((c, i) => ordner.file(chunkName(i), JSON.stringify(c)));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
    (m) => status(`ZIP wird erstellt … ${Math.round(m.percent)} %`));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "materials-chunks.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  status("✓ materials-chunks.zip heruntergeladen.");
}

/* ---------- Oberfläche (in den Einstellungen) ---------- */

function zahlDE0(n) { return Number(n || 0).toLocaleString("de-DE"); }

async function renderKatalogEinstellungen(platz) {
  if (!platz) return;
  platz.innerHTML = `
    <div class="section-card einstellungen-karte">
      <strong>Großhandelskatalog (DATANORM)</strong>
      <p class="hint" id="k_info">wird ermittelt …</p>
      <label>DATANORM-Datei einlesen (DATANORM.001 oder ZIP vom Großhändler)
        <input type="file" id="k_datei">
      </label>
      <label>Zeichensatz
        <select id="k_zs">
          <option value="auto">automatisch erkennen</option>
          <option value="cp850">DOS / CP850 (Standard bei DATANORM)</option>
          <option value="windows-1252">Windows-1252</option>
          <option value="utf-8">UTF-8</option>
        </select>
      </label>
      <p class="hint" id="k_status" hidden></p>
      <div id="k_ergebnis"></div>
      <p class="hint">Am besten am PC einlesen (große Datei). „Für alle Geräte“: ZIP herunterladen, entpacken und den Ordner <code>materials-chunks</code> im GitHub-Repo „Aufmasssoftware“ ersetzen – danach laden alle Geräte den neuen Katalog. „Nur dieses Gerät“: sofort nutzbar, ohne GitHub.</p>
    </div>`;
  const info = platz.querySelector("#k_info");
  const status = (t) => { const el = platz.querySelector("#k_status"); el.hidden = !t; el.textContent = t || ""; };
  const zeigeInfo = async () => {
    const m = materialDBManifest;
    let text = !m ? (materialDBFehler || materialDBStatus)
      : `${zahlDE0(m.count || materialDB.length)} Artikel · Stand ${m.version || "–"} · ${m.quelle === "lokal" ? `eigener Katalog auf diesem Gerät (${m.datei || ""}, ${m.datum ? formatDatumDE(m.datum.slice(0, 10)) : ""})` : "vom Server (GitHub)"}`;
    if (!materialDBReady && m) text += " – wird geladen …";
    info.textContent = text;
    const alt = platz.querySelector("#k_entfernen");
    if (alt) alt.remove();
    if (m && m.quelle === "lokal") {
      const b = document.createElement("button");
      b.type = "button";
      b.id = "k_entfernen";
      b.className = "btn-link-accent";
      b.textContent = "Eigenen Katalog entfernen – wieder den Server-Katalog verwenden";
      b.addEventListener("click", async () => {
        if (!confirm("Eigenen Katalog von diesem Gerät entfernen und wieder den Katalog vom Server laden?")) return;
        status("Server-Katalog wird geladen …");
        await entferneLokalenKatalog();
        status("");
        zeigeInfo();
      });
      info.after(b);
    }
  };
  zeigeInfo();
  const l = () => { if (!document.body.contains(info)) { materialDBListener.delete(l); return; } zeigeInfo(); };
  materialDBListener.add(l);

  platz.querySelector("#k_datei").addEventListener("change", async (ev) => {
    const datei = ev.target.files[0];
    if (!datei) return;
    const ergebnis = platz.querySelector("#k_ergebnis");
    ergebnis.innerHTML = "";
    katalogImport = null;
    try {
      const imp = await leseDatanormDatei(datei, platz.querySelector("#k_zs").value, status);
      if (!imp.anzahl) throw new Error("Keine Artikel (A-Sätze) gefunden – ist das eine DATANORM-4-Hauptdatei? Ggf. Zeichensatz prüfen.");
      katalogImport = imp;
      status("");
      const beispiel = imp.chunks[0].slice(0, 3).map((a) => `${a.n} – ${a.b}`).join("\n");
      ergebnis.innerHTML = `<div class="k-ergebnis">
          <p><strong>${zahlDE0(imp.anzahl)} Artikel</strong> eingelesen, davon ${zahlDE0(imp.mitEan)} mit EAN · Zeichensatz ${imp.zeichensatz} · Stand ${imp.version}</p>
          <pre class="k-beispiel"></pre>
          <div class="action-bar">
            <button type="button" class="btn btn-primary" id="k_zip">Für alle Geräte: ZIP für GitHub herunterladen</button>
            <button type="button" class="btn btn-secondary" id="k_lokal">Nur auf diesem Gerät verwenden</button>
          </div>
        </div>`;
      ergebnis.querySelector(".k-beispiel").textContent = beispiel + "\n…";
      ergebnis.querySelector("#k_zip").addEventListener("click", async () => {
        try { await ladeKatalogZipHerunter(katalogImport, status); } catch (e) { status("Fehler: " + e.message); }
      });
      ergebnis.querySelector("#k_lokal").addEventListener("click", async () => {
        try {
          await verwendeKatalogLokal(katalogImport, status);
          status(`✓ Eigener Katalog aktiv (${zahlDE0(katalogImport.anzahl)} Artikel).`);
          zeigeInfo();
        } catch (e) { status("Fehler beim Speichern: " + e.message); }
      });
    } catch (e) {
      console.error(e);
      status("Fehler: " + e.message);
    }
    ev.target.value = "";
  });
}
