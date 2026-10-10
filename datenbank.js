"use strict";

/* ============================================================
   Zentrale Materialdatenbank (seit Version 15.0)
   Ersetzt die bisher getrennten Listen
     - Standardmaterial (standardmaterial.json + eigene Ergänzungen)
     - Produktliste fürs Bauaufmaß (Abdeckungen, KNX, Melder, Verteilung)
     - eigene Artikel (unbekannte EAN)
   durch EINE Datenbank mit Kategorien:
     am2_kategorien: freie Kategorien [{id, name}]
     am2_material:   Einträge [{id, kat, name, nr, ean, einheit}]
   Systemkategorien (für die Auswahlfelder im Bauaufmaß) kommen aus
   PRODUKT_KATEGORIEN (bauaufmass.js) und haben die id "sys:<key>".
   IDs beim Übernehmen alter Daten sind deterministisch, damit mehrere
   Geräte beim Cloud-Sync keine Dubletten erzeugen. Übernommene Einträge
   tragen _imp: true (cloudsync.js behandelt sie dann als „alt“).
   Wird nach bauaufmass.js und vor app.js geladen.
   ============================================================ */

const STORAGE_KEY_KATEGORIEN = "am2_kategorien";
const STORAGE_KEY_MATERIAL = "am2_material";
const DB_VERSION_KEY = "am2_db_version";
const KAT_EIGENE = "kat:eigene-artikel";
const STORAGE_KEY_ORDNER = "am2_ordner"; // v19: Baustellen-Ordner [{ id, name, erstellt }]
const EINHEITEN = ["Stck", "m", "Pack", "Rolle", "Satz", "kg", "VE", "Paar"];

let dbKategorien = [];  // freie Kategorien
let dbMaterial = [];
let dbOrdner = [];      // v19: Baustellen-Ordner; Material mit `ordner: <id>` gehört nur zu dieser Baustelle

function dbIdHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function katIdAusName(name) {
  const slug = name.toLowerCase().replace(/[äöüß]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" }[c]))
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return "kat:" + (slug || dbIdHash(name));
}

/* ---------- Laden / Speichern ---------- */

function ladeDatenbank() {
  try { dbKategorien = JSON.parse(localStorage.getItem(STORAGE_KEY_KATEGORIEN) || "[]"); } catch (e) { dbKategorien = []; }
  try { dbMaterial = JSON.parse(localStorage.getItem(STORAGE_KEY_MATERIAL) || "[]"); } catch (e) { dbMaterial = []; }
  try { dbOrdner = JSON.parse(localStorage.getItem(STORAGE_KEY_ORDNER) || "[]"); } catch (e) { dbOrdner = []; }
  if (!dbKategorien.some((k) => k.id === KAT_EIGENE)) dbKategorien.push({ id: KAT_EIGENE, name: "Eigene Artikel" });
  // Systemkategorie, in die (z. B. über ein Auswahlfeld) wieder etwas eingetragen wurde, nicht mehr verstecken
  dbKategorien = dbKategorien.filter((k) => !(k.versteckt && dbMaterial.some((m) => m.kat === k.id)));
  aktualisiereAbgeleiteteListen();
}

function speichereKategorien() {
  try { localStorage.setItem(STORAGE_KEY_KATEGORIEN, JSON.stringify(dbKategorien)); }
  catch (e) { console.error(e); alert("Speichern der Kategorien fehlgeschlagen."); }
}

function speichereMaterial() {
  try { localStorage.setItem(STORAGE_KEY_MATERIAL, JSON.stringify(dbMaterial)); }
  catch (e) { console.error(e); alert("Speichern der Materialdatenbank fehlgeschlagen (Speicher voll?)."); }
  aktualisiereAbgeleiteteListen();
}

// Aus der Datenbank abgeleitete Listen für „Standardmaterial“ und „Aus Liste“ (eigene Artikel)
function aktualisiereAbgeleiteteListen() {
  if (typeof standardMaterialDB === "undefined") return; // app.js noch nicht geladen
  const reihenfolge = new Map(alleKategorien().map((k, i) => [k.id, i]));
  const sichtbar = dbMaterial.filter(imKontextSichtbar);
  standardMaterialDB = sichtbar
    .map((m) => m.ordner
      ? { id: m.id, k: "📁 " + ordnerName(m.ordner), b: m.name, e: m.einheit || "Stck", n: m.nr || "", g: m.ean || "", _r: -1 }
      : { id: m.id, k: kategorieName(m.kat), b: m.name, e: m.einheit || "Stck", n: m.nr || "", g: m.ean || "", _r: reihenfolge.has(m.kat) ? reihenfolge.get(m.kat) : 999 })
    .sort((a, b) => a._r - b._r || a.b.localeCompare(b.b, "de"))
    .map((a) => ({ ...a, _s: (a.k + " " + a.b + " " + a.n + " " + a.g).toLowerCase() }));
  standardMaterialDBReady = true;
  eigeneArtikel = sichtbar
    .filter((m) => m.ean || m.nr)
    .map((m) => ({ n: m.nr || m.ean, b: m.name, e: m.einheit || "Stck", g: m.ean || "", _eigen: true, _dbId: m.id, _s: ((m.nr || "") + " " + (m.ean || "") + " " + m.name).toLowerCase() }));
}

/* ---------- Kategorien ---------- */

function systemKategorien() {
  return PRODUKT_KATEGORIEN.map((k) => ({ id: "sys:" + k.key, name: k.b, gruppe: k.gruppe || "Bauaufmaß", system: true, einheit: k.einheit || "Stck", ph: k.ph || "" }));
}

// v16: Systemkategorien können „gelöscht“ (= geleert + ausgeblendet) werden.
// Gespeichert als { id: "sys:<key>", versteckt: true } in den Kategorien.
function istVersteckt(katId) {
  return dbKategorien.some((k) => k.id === katId && k.versteckt);
}

function alleKategorien(mitVersteckten) {
  const frei = dbKategorien.filter((k) => !k.id.startsWith("sys:")).map((k) => ({ ...k, gruppe: "Standardmaterial", system: false }));
  frei.sort((a, b) => (a.id === KAT_EIGENE) - (b.id === KAT_EIGENE));
  const sys = systemKategorien().filter((k) => mitVersteckten || !istVersteckt(k.id) || dbMaterial.some((m) => m.kat === k.id));
  return frei.concat(sys);
}

function kategorieInfo(katId) {
  return alleKategorien(true).find((k) => k.id === katId) || { id: katId, name: "Ohne Kategorie", gruppe: "Standardmaterial", system: false };
}

// Ganze Kategorie löschen: freie Kategorie samt Einträgen entfernen,
// Systemkategorie leeren und ausblenden (wird für die Auswahlfelder gebraucht).
function loescheKategorie(katId) {
  dbMaterial = dbMaterial.filter((m) => m.kat !== katId);
  if (katId.startsWith("sys:")) {
    if (!istVersteckt(katId)) dbKategorien.push({ id: katId, versteckt: true });
  } else {
    dbKategorien = dbKategorien.filter((k) => k.id !== katId);
  }
  speichereKategorien();
  speichereMaterial();
}

function blendeKategorienEin() {
  dbKategorien = dbKategorien.filter((k) => !k.versteckt);
  speichereKategorien();
  aktualisiereAbgeleiteteListen();
}

function kategorieName(katId) {
  return kategorieInfo(katId).name;
}

function legeKategorieAn(name) {
  const n = name.trim();
  if (!n) return null;
  const vorhanden = dbKategorien.find((k) => k.name && k.name.toLowerCase() === n.toLowerCase());
  if (vorhanden) return vorhanden;
  let id = katIdAusName(n);
  while (dbKategorien.some((k) => k.id === id) || id.startsWith("sys:")) id += "-2";
  const k = { id, name: n };
  dbKategorien.push(k);
  speichereKategorien();
  return k;
}

// <select> mit allen Kategorien, gruppiert
function fuelleKategorieSelect(select, gewaehlt, mitNeu) {
  select.innerHTML = "";
  let og = null;
  for (const k of alleKategorien()) {
    if (!og || og.label !== k.gruppe) {
      og = document.createElement("optgroup");
      og.label = k.gruppe;
      select.appendChild(og);
    }
    const o = document.createElement("option");
    o.value = k.id;
    o.textContent = k.name;
    og.appendChild(o);
  }
  if (mitNeu) {
    const o = document.createElement("option");
    o.value = "__neu__";
    o.textContent = "➕ Neue Kategorie…";
    select.appendChild(o);
  }
  if (gewaehlt) select.value = gewaehlt;
}

/* ---------- Einträge ---------- */

function dbMaterialDerKategorie(katId) {
  return dbMaterial.filter((m) => m.kat === katId).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

function dbFindeCode(code) {
  const c = (code || "").trim();
  if (!c) return null;
  return dbMaterial.find((m) => (m.ean && m.ean === c) || (m.nr && m.nr === c)) || null;
}

// Neuer Eintrag; gleicher Name in gleicher Kategorie -> vorhandenen aktualisieren
function dbNeu({ kat, name, nr, ean, einheit, ordner }) {
  const n = (name || "").trim();
  if (!n) return null;
  let m = dbMaterial.find((x) => x.kat === kat && (x.ordner || "") === (ordner || "") && x.name.toLowerCase() === n.toLowerCase());
  if (m) {
    if (nr) m.nr = nr;
    if (ean) m.ean = ean;
    if (einheit) m.einheit = einheit;
    delete m._imp;
  } else {
    m = { id: neueId(), kat, name: n, nr: nr || "", ean: ean || "", einheit: einheit || kategorieInfo(kat).einheit || "Stck" };
    if (ordner) m.ordner = ordner;
    dbMaterial.push(m);
  }
  speichereMaterial();
  return m;
}

function dbAendern(m, felder) {
  Object.assign(m, felder);
  delete m._imp;
  speichereMaterial();
}

function dbLoeschen(id) {
  dbMaterial = dbMaterial.filter((m) => m.id !== id);
  speichereMaterial();
}

/* ---------- Übernahme der alten Listen (einmalig je Gerät) ---------- */

async function initDatenbank() {
  ladeDatenbank();
  if (localStorage.getItem(DB_VERSION_KEY)) return;
  const neu = [];
  const katFuer = (name) => {
    const k = legeKategorieAn(name || "Sonstige Standardartikel");
    return k.id;
  };
  const add = (m) => { if (!dbMaterial.some((x) => x.id === m.id) && !neu.some((x) => x.id === m.id)) neu.push({ ...m, _imp: true }); };
  // 1. Standardmaterial-Grundliste
  try {
    const res = await fetch("standardmaterial.json");
    const daten = await res.json();
    for (const a of daten) add({ id: "std:" + dbIdHash(a.k + "|" + a.b), kat: katFuer(a.k), name: a.b, nr: "", ean: "", einheit: a.e || "Stck" });
  } catch (e) {
    console.error("standardmaterial.json konnte nicht geladen werden – Übernahme beim nächsten Start", e);
    return; // ohne Grundliste nicht als erledigt markieren
  }
  // 2. eigene Standardmaterial-Ergänzungen
  try {
    for (const a of JSON.parse(localStorage.getItem("am2_standard_ergaenzungen") || "[]")) {
      add({ id: "std:" + dbIdHash(a.k + "|" + a.b), kat: katFuer(a.k), name: a.b, nr: a.n || "", ean: "", einheit: a.e || "Stck" });
    }
  } catch (e) { /* egal */ }
  // 3. eigene Artikel (unbekannte EAN)
  try {
    for (const a of JSON.parse(localStorage.getItem("am2_eigene_artikel") || "[]")) {
      if (!a.g && !a.n) continue;
      add({ id: "ean:" + (a.g || a.n), kat: KAT_EIGENE, name: a.b, nr: "", ean: a.g || a.n, einheit: a.e || "Stck" });
    }
  } catch (e) { /* egal */ }
  // 4. Produktliste (Bauaufmaß)
  try {
    for (const p of JSON.parse(localStorage.getItem("am2_produkte") || "[]")) {
      const info = PRODUKT_KATEGORIEN.find((k) => k.key === p.kat) || {};
      add({ id: p.id, kat: "sys:" + p.kat, name: p.name, nr: p.nr || "", ean: p.ean || "", einheit: info.einheit || "Stck" });
    }
  } catch (e) { /* egal */ }
  dbMaterial = dbMaterial.concat(neu);
  speichereKategorien();
  speichereMaterial();
  localStorage.setItem(DB_VERSION_KEY, "1");
  if (typeof aktualisiereListenansicht === "function") aktualisiereListenansicht();
}

/* ---------- Formular: Eintrag anlegen / bearbeiten ----------
   Kamera-Scan bzw. Eingabe von EAN/Art.-Nr. sucht im Großhandelskatalog
   (DATANORM) und in der eigenen Datenbank und füllt Bezeichnung + Art.-Nr. */
function baueMaterialFormular({ katId, katFest, eintrag, onSave, onCancel, ordner }) {
  const form = document.createElement("div");
  form.className = "selected-article produkt-form";
  form.innerHTML = `
    <label class="pf-kat-wrap">Kategorie <select class="pf-kat"></select></label>
    <div class="pf-katneu inline-add" hidden><input type="text" placeholder="Name der neuen Kategorie"></div>
    <label>EAN / Art.-Nr. (optional – scannen oder eingeben)
      <div class="suche-mit-scan">
        <input type="text" class="pf-code" inputmode="numeric" autocomplete="off" placeholder="z. B. 4011377…">
        <button type="button" class="btn-scan pf-scan" aria-label="Barcode scannen">📷</button>
        <button type="button" class="btn btn-secondary pf-suchen">Suchen</button>
      </div>
    </label>
    <p class="hint pf-hinweis" hidden></p>
    <label>…oder im Großhandelskatalog suchen (Text)
      <div class="autocomplete">
        <input type="search" class="pf-katsuche" placeholder="z. B. Leitungsschutz B16 Hager" autocomplete="off">
        <ul class="suggest-list pf-treffer" hidden></ul>
      </div>
    </label>
    <label>Bezeichnung <input type="text" class="pf-name" autocomplete="off"></label>
    <div class="field-grid two-col">
      <label>Art.-Nr. <input type="text" class="pf-nr" autocomplete="off"></label>
      <label>Einheit <input type="text" class="pf-einheit" list="pf_einheiten" autocomplete="off"></label>
    </div>
    <datalist id="pf_einheiten">${EINHEITEN.map((e) => `<option value="${e}"></option>`).join("")}</datalist>
    ${ordnerCheckboxHtml(eintrag ? eintrag.ordner : ordner)}
    <div class="action-bar">
      <button type="button" class="btn btn-secondary pf-speichern" disabled>${eintrag ? "Änderungen speichern" : "In Datenbank speichern"}</button>
      <button type="button" class="btn-danger-text pf-abbrechen">Abbrechen</button>
    </div>`;
  const katSel = form.querySelector(".pf-kat");
  const katNeu = form.querySelector(".pf-katneu");
  const name = form.querySelector(".pf-name");
  const nr = form.querySelector(".pf-nr");
  const einheit = form.querySelector(".pf-einheit");
  const code = form.querySelector(".pf-code");
  const hinweis = form.querySelector(".pf-hinweis");
  const btnSpeichern = form.querySelector(".pf-speichern");
  fuelleKategorieSelect(katSel, (eintrag && eintrag.kat) || katId || KAT_EIGENE, true);
  if (katFest) form.querySelector(".pf-kat-wrap").hidden = true;
  const setzePlatzhalter = () => {
    const info = kategorieInfo(katSel.value);
    name.placeholder = info.ph || "Bezeichnung";
    if (!eintrag && !einheit.value) einheit.value = info.einheit || "Stck";
  };
  katSel.addEventListener("change", () => {
    katNeu.hidden = katSel.value !== "__neu__";
    if (!katNeu.hidden) katNeu.querySelector("input").focus();
    else setzePlatzhalter();
  });
  if (eintrag) {
    name.value = eintrag.name;
    nr.value = eintrag.nr || "";
    einheit.value = eintrag.einheit || "Stck";
    code.value = eintrag.ean || "";
  }
  setzePlatzhalter();
  const pruefe = () => { btnSpeichern.disabled = !name.value.trim(); };
  name.addEventListener("input", pruefe);
  pruefe();

  const suche = (wert) => {
    const c = (wert || "").trim();
    if (!c) { code.focus(); return; }
    code.value = c;
    hinweis.hidden = false;
    const inDb = dbFindeCode(c);
    if (inDb && (!eintrag || inDb.id !== eintrag.id)) {
      hinweis.innerHTML = `ℹ Schon in der Datenbank: <strong>${escapeHtml(inDb.name)}</strong> (${escapeHtml(kategorieName(inDb.kat))}).`;
      return;
    }
    const treffer = typeof materialDB !== "undefined"
      ? (sucheNachEan(c, 3).find((a) => !a._eigen) || materialDB.find((a) => a.n === c))
      : null;
    if (treffer) {
      name.value = treffer.b;
      nr.value = treffer.n;
      einheit.value = treffer.e || einheit.value;
      hinweis.innerHTML = `✓ Im Katalog gefunden: <strong>${escapeHtml(treffer.b)}</strong> – Bezeichnung kann angepasst werden.`;
    } else {
      hinweis.textContent = (typeof materialDBReady !== "undefined" && !materialDBReady)
        ? "Katalog wird noch geladen – Bezeichnung bitte selbst eintragen oder gleich noch einmal suchen."
        : "Nicht im Katalog gefunden – Bezeichnung bitte selbst eintragen.";
      name.focus();
    }
    pruefe();
  };
  // v16: Textsuche im Großhandelskatalog (DATANORM), Auswahl übernimmt Bezeichnung, Art.-Nr., EAN, Einheit
  const katSuche = form.querySelector(".pf-katsuche");
  const katTreffer = form.querySelector(".pf-treffer");
  let katTimer = null;
  const zeigeKatalogTreffer = () => {
    const q = katSuche.value.trim();
    katTreffer.innerHTML = "";
    if (q.length < 2) { katTreffer.hidden = true; return; }
    if (typeof materialDBReady !== "undefined" && !materialDBReady) {
      katTreffer.innerHTML = `<li class="no-result">${escapeHtml(materialDBFehler || materialDBStatus)}</li>`;
      katTreffer.hidden = false;
      return;
    }
    const treffer = sucheMaterial(q, 40).filter((a) => !a._eigen).slice(0, 25);
    if (!treffer.length) katTreffer.innerHTML = '<li class="no-result">Keine Treffer im Katalog</li>';
    for (const a of treffer) {
      const li = document.createElement("li");
      li.innerHTML = `${escapeHtml(a.b)}<small>Art.-Nr. ${escapeHtml(a.n)}${a.g ? " · EAN " + escapeHtml(a.g) : ""} · ${escapeHtml(a.e)}</small>`;
      li.addEventListener("click", () => {
        name.value = a.b;
        nr.value = a.n;
        einheit.value = a.e || einheit.value;
        code.value = a.g || "";
        katTreffer.hidden = true;
        katSuche.value = "";
        hinweis.hidden = false;
        hinweis.innerHTML = `✓ Aus dem Katalog übernommen: <strong>${escapeHtml(a.b)}</strong> – Bezeichnung kann angepasst werden.`;
        pruefe();
      });
      katTreffer.appendChild(li);
    }
    katTreffer.hidden = false;
  };
  katSuche.addEventListener("input", () => { clearTimeout(katTimer); katTimer = setTimeout(zeigeKatalogTreffer, 200); });
  if (typeof materialDBListener !== "undefined") {
    const l = () => { if (!document.body.contains(katSuche)) { materialDBListener.delete(l); return; } if (!katTreffer.hidden) zeigeKatalogTreffer(); };
    materialDBListener.add(l);
  }

  form.querySelector(".pf-suchen").addEventListener("click", () => suche(code.value));
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); suche(code.value); } });
  form.querySelector(".pf-scan").addEventListener("click", () => oeffneBarcodeScanner((roh) => suche(roh)));

  btnSpeichern.addEventListener("click", () => {
    const n = name.value.trim();
    if (!n) return;
    let kat = katSel.value;
    if (kat === "__neu__") {
      const k = legeKategorieAn(katNeu.querySelector("input").value);
      if (!k) { katNeu.querySelector("input").focus(); return; }
      kat = k.id;
    }
    const c = code.value.trim();
    const ean = istEanAehnlich(c) ? c : "";
    const artNr = nr.value.trim() || (c && !ean ? c : "");
    const e = einheit.value.trim() || "Stck";
    const ord = gewaehlterOrdner(form, eintrag ? eintrag.ordner : ordner);
    let ergebnis;
    if (eintrag) { dbAendern(eintrag, { kat, name: n, nr: artNr, ean, einheit: e }); setzeOrdner(eintrag, ord); ergebnis = eintrag; }
    else ergebnis = dbNeu({ kat, name: n, nr: artNr, ean, einheit: e, ordner: ord });
    onSave(ergebnis);
  });
  form.querySelector(".pf-abbrechen").addEventListener("click", () => onCancel && onCancel());
  if (!eintrag) setTimeout(() => (katFest ? name : code).focus(), 0);
  return form;
}

// Kompatibel zu den Auswahlfeldern im Bauaufmaß (Kategorie-Schlüssel ohne "sys:")
function baueProduktFormular({ kat, onSave, onCancel }) {
  return baueMaterialFormular({ katId: "sys:" + kat, katFest: true, onSave, onCancel, ordner: aktiverOrdnerId() });
}

// Auswahlfelder im Bauaufmaß: Material des eigenen Baustellen-Ordners zuerst, fremde Ordner ausgeblendet
function produkteDerKategorie(kat) {
  const liste = dbMaterialDerKategorie("sys:" + kat).filter(imKontextSichtbar);
  return liste.filter((m) => m.ordner).concat(liste.filter((m) => !m.ordner));
}

/* ---------- Verwaltungsansicht ---------- */

function oeffneDatenbank(suchtext) {
  setzeAnsicht("datenbank");
  currentAufmass = null;
  currentPackliste = null;
  currentBauaufmass = null;
  currentRaum = null;
  zurueckAktion = oeffneEinstellungen;
  headerTitle.textContent = "Materialdatenbank";
  btnBack.hidden = false;
  btnNew.hidden = true;
  app.innerHTML = "";
  const view = document.createElement("section");
  view.className = "view";
  view.innerHTML = `
    <div class="db-kopf">
      <input type="search" class="db-suche" placeholder="Suchen (Bezeichnung, Art.-Nr., EAN)…" autocomplete="off">
      <div class="db-aktionen">
        <button type="button" class="btn btn-primary db-neu">＋ Material</button>
        <button type="button" class="btn btn-secondary db-scan">📷 Scannen</button>
        <button type="button" class="btn btn-outline-neutral db-katneu">＋ Kategorie</button>
      </div>
      <div class="db-filter segment" role="radiogroup">
        <button type="button" class="segment-btn" data-f="alle">Alle</button>
        <button type="button" class="segment-btn" data-f="benutzt">Benutzt</button>
        <button type="button" class="segment-btn" data-f="doppelte">Doppelte</button>
      </div>
      <div class="db-form"></div>
    </div>
    <div class="db-ordner"></div>
    <p class="hint db-info"></p>
    <div class="db-liste view"></div>
    <details class="section-card">
      <summary>Sichern / Wiederherstellen</summary>
      <p class="hint">Die Datenbank wird mit dem Cloud-Sync automatisch abgeglichen. Zusätzlich kannst du sie als Datei sichern.</p>
      <div class="action-bar">
        <button type="button" class="btn btn-secondary db-export">Als Datei sichern</button>
        <label class="btn btn-outline-neutral db-import-label">Datei einlesen<input type="file" accept="application/json,.json" class="db-import" hidden></label>
      </div>
    </details>`;
  app.appendChild(view);
  window.scrollTo(0, 0);

  const suche = view.querySelector(".db-suche");
  const formPlatz = view.querySelector(".db-form");
  const liste = view.querySelector(".db-liste");
  const info = view.querySelector(".db-info");
  const ordnerPlatz = view.querySelector(".db-ordner");
  const offen = new Set();
  suche.value = suchtext || "";

  const zeigeFormular = (opts) => {
    formPlatz.innerHTML = "";
    formPlatz.appendChild(baueMaterialFormular({
      ...opts,
      onSave: (m) => { formPlatz.innerHTML = ""; offen.add(m.kat); render(); },
      onCancel: () => { formPlatz.innerHTML = ""; }
    }));
    formPlatz.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  view.querySelector(".db-neu").addEventListener("click", () => zeigeFormular({}));
  view.querySelector(".db-scan").addEventListener("click", () => {
    zeigeFormular({});
    formPlatz.querySelector(".pf-scan").click();
  });
  view.querySelector(".db-katneu").addEventListener("click", () => {
    const n = prompt("Name der neuen Kategorie:");
    if (n && n.trim()) { const k = legeKategorieAn(n); offen.add(k.id); render(); }
  });

  // Aufmaßsoftware: Filter Alle / Benutzt / Doppelte (Auswahl wird gemerkt)
  let filter = "alle";
  try { filter = localStorage.getItem("am2_db_filter") || "alle"; } catch (e) { /* egal */ }
  let benutzt = null;
  const zeichneFilter = () => view.querySelectorAll(".db-filter .segment-btn").forEach((b) => b.classList.toggle("aktiv", b.dataset.f === filter));
  view.querySelectorAll(".db-filter .segment-btn").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.f;
    try { localStorage.setItem("am2_db_filter", filter); } catch (e) { /* egal */ }
    benutzt = null;
    zeichneFilter();
    render();
  }));
  zeichneFilter();

  const render = () => {
    const q = suche.value.trim().toLowerCase();
    const worte = q.split(/\s+/).filter(Boolean);
    liste.innerHTML = "";
    let letzteGruppe = null;
    let sichtbar = 0;
    if (filter === "doppelte") { ordnerPlatz.innerHTML = ""; renderDoppelte(liste, info, render); return; }
    if (filter === "benutzt" && !benutzt) benutzt = benutzteNamen();
    renderOrdner(worte);
    for (const k of alleKategorien()) {
      let eintraege = dbMaterialDerKategorie(k.id).filter((m) => !m.ordner);
      if (filter === "benutzt") {
        eintraege = eintraege.filter((m) => benutzt.has(m.name.trim().toLowerCase()));
        if (!eintraege.length) continue;
      }
      if (worte.length) {
        eintraege = eintraege.filter((m) => {
          const s = (m.name + " " + (m.nr || "") + " " + (m.ean || "") + " " + k.name + (istKombi(m) ? " " + kombiBeschreibung(m) : "")).toLowerCase();
          return worte.every((w) => s.includes(w));
        });
        if (!eintraege.length) continue;
      }
      if (k.gruppe !== letzteGruppe) {
        letzteGruppe = k.gruppe;
        const h = document.createElement("h3");
        h.className = "pl-gruppe";
        h.textContent = k.gruppe;
        liste.appendChild(h);
      }
      sichtbar += eintraege.length;
      const det = document.createElement("details");
      det.className = "section-card";
      det.open = worte.length > 0 || offen.has(k.id);
      det.addEventListener("toggle", () => { if (det.open) offen.add(k.id); else offen.delete(k.id); });
      det.innerHTML = `<summary><span></span></summary>
        <div class="db-kat-aktionen"></div>
        <ul class="pl-eintraege"></ul>`;
      det.querySelector("summary span").textContent = `${k.name} (${eintraege.length})`;
      const akt = det.querySelector(".db-kat-aktionen");
      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "btn-link-accent";
      plus.textContent = "＋ Material in dieser Kategorie";
      plus.addEventListener("click", () => zeigeFormular({ katId: k.id }));
      akt.appendChild(plus);
      if (KOMBI_KATEGORIEN.includes(k.id)) {
        const kombi = document.createElement("button");
        kombi.type = "button";
        kombi.className = "btn-link-accent";
        kombi.textContent = "＋ Kombination";
        kombi.addEventListener("click", () => {
          formPlatz.innerHTML = "";
          formPlatz.appendChild(baueKombiFormular({
            katId: k.id,
            onSave: (m) => { formPlatz.innerHTML = ""; offen.add(m.kat); render(); },
            onCancel: () => { formPlatz.innerHTML = ""; }
          }));
          formPlatz.scrollIntoView({ block: "start", behavior: "smooth" });
        });
        akt.appendChild(kombi);
      }
      if (!k.system && k.id !== KAT_EIGENE) {
        const ren = document.createElement("button");
        ren.type = "button";
        ren.className = "btn-mini";
        ren.textContent = "✎";
        ren.setAttribute("aria-label", "Kategorie umbenennen");
        ren.addEventListener("click", () => {
          const n = prompt("Kategorie umbenennen:", k.name);
          if (n && n.trim()) { const kk = dbKategorien.find((x) => x.id === k.id); kk.name = n.trim(); speichereKategorien(); aktualisiereAbgeleiteteListen(); render(); }
        });
        akt.appendChild(ren);
      }
      // v16: jede Kategorie komplett löschbar
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-mini btn-mini-danger";
      del.textContent = "🗑";
      del.setAttribute("aria-label", "Ganze Kategorie löschen");
      del.addEventListener("click", () => {
        const anzahl = dbMaterialDerKategorie(k.id).length;
        const zusatz = k.system ? "\n\n(Die Kategorie wird ausgeblendet und kann unten wieder eingeblendet werden.)" : "";
        if (!confirm(`Ganze Kategorie „${k.name}“${anzahl ? ` mit ${anzahl} Einträgen` : ""} löschen?${zusatz}`)) return;
        loescheKategorie(k.id);
        render();
      });
      akt.appendChild(del);
      const ul = det.querySelector("ul");
      if (!eintraege.length) {
        const li = document.createElement("li");
        li.className = "hint";
        li.textContent = "Noch keine Einträge.";
        ul.appendChild(li);
      }
      for (const m of eintraege) {
        const li = document.createElement("li");
        li.className = "pl-eintrag";
        li.innerHTML = `<div class="info"><strong></strong><small></small></div>
          <span class="komp-aktionen">
            <button type="button" class="stern-btn" aria-label="Favorit"></button>
            <button type="button" class="btn-mini" aria-label="In Baustellen-Ordner verschieben">📁</button>
            <button type="button" class="btn-mini" aria-label="Bearbeiten">✎</button>
            <button type="button" class="btn-mini btn-mini-danger" aria-label="Löschen">✕</button>
          </span>`;
        li.querySelector("strong").textContent = m.name;
        li.querySelector("small").textContent = istKombi(m)
          ? "Kombination: " + kombiBeschreibung(m)
          : [m.einheit || "Stck", m.nr && `Art.-Nr. ${m.nr}`, m.ean && `EAN ${m.ean}`].filter(Boolean).join(" · ");
        bindeSternKnopf(li.querySelector(".stern-btn"), sternDatenFuerDb(m));
        li.querySelector('[aria-label="In Baustellen-Ordner verschieben"]').addEventListener("click", () => {
          const info = li.querySelector(".info");
          if (info.querySelector(".db-verschieben")) return;
          const sel = baueVerschiebenAuswahl(m, (ziel) => { if (ziel) offeneOrdner.add(ziel); else offen.add(m.kat); render(); });
          info.appendChild(sel);
          sel.focus();
        });
        li.querySelector('[aria-label="Bearbeiten"]').addEventListener("click", () => {
          const platz = document.createElement("li");
          platz.appendChild(istKombi(m)
            ? baueKombiFormular({ katId: m.kat, eintrag: m, onSave: (x) => { offen.add(x.kat); render(); }, onCancel: render })
            : baueMaterialFormular({
              eintrag: m,
              onSave: (x) => { offen.add(x.kat); render(); },
              onCancel: render
            }));
          li.replaceWith(platz);
        });
        li.querySelector('[aria-label="Löschen"]').addEventListener("click", () => {
          if (!confirm(`„${m.name}“ aus der Datenbank löschen? (Bereits erfasste Aufmaße behalten den Eintrag.)`)) return;
          dbLoeschen(m.id);
          render();
        });
        ul.appendChild(li);
      }
      liste.appendChild(det);
    }
    info.textContent = filter === "benutzt"
      ? (sichtbar ? `${sichtbar} benutzte Einträge (in Aufmaßen, Bauaufmaßen, Favoriten oder schon einmal hinzugefügt).` : "Noch nichts benutzt – oben auf „Alle“ tippen.")
      : worte.length
      ? `${sichtbar} Treffer`
      : `${dbMaterial.filter((m) => !m.ordner).length} Einträge in ${alleKategorien().length} Kategorien. Kategorie antippen zum Aufklappen, ☆ = zu Favoriten.`;
    const versteckt = dbKategorien.filter((k) => k.versteckt).length;
    if (versteckt && !worte.length) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-link-accent";
      b.textContent = `${versteckt} gelöschte Bauaufmaß-Kategorie${versteckt === 1 ? "" : "n"} wieder einblenden`;
      b.addEventListener("click", () => { blendeKategorienEin(); render(); });
      liste.appendChild(b);
    }
  };
  // v19: Baustellen-Ordner oberhalb der Kategorien
  const offeneOrdner = new Set();
  const zeigeOrdnerFormular = (o, kombi) => {
    formPlatz.innerHTML = "";
    const fertig = () => { formPlatz.innerHTML = ""; offeneOrdner.add(o.id); render(); };
    formPlatz.appendChild(kombi
      ? baueKombiFormular({ katId: "sys:strahler", ordner: o.id, onSave: fertig, onCancel: () => { formPlatz.innerHTML = ""; } })
      : baueMaterialFormular({ katId: "sys:strahler", ordner: o.id, onSave: fertig, onCancel: () => { formPlatz.innerHTML = ""; } }));
    formPlatz.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  function renderOrdner(worte) {
    ordnerPlatz.innerHTML = "";
    const kopf = document.createElement("div");
    kopf.className = "db-ordner-kopf";
    kopf.innerHTML = `<h3 class="pl-gruppe">📁 Baustellen-Ordner</h3>`;
    const neu = document.createElement("button");
    neu.type = "button";
    neu.className = "btn-link-accent";
    neu.textContent = "＋ Baustellen-Ordner";
    neu.addEventListener("click", () => {
      const n = prompt("Name des Baustellen-Ordners (z. B. Baustelle oder Kunde):");
      const o = n && legeOrdnerAn(n);
      if (o) { offeneOrdner.add(o.id); render(); }
    });
    kopf.appendChild(neu);
    ordnerPlatz.appendChild(kopf);
    if (!dbOrdner.length && !worte.length) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "Für Material, das nur auf einer Baustelle gebraucht wird. Im Bauaufmaß den Ordner auswählen – dann steht dieses Material überall ganz oben und taucht in anderen Aufmaßen nicht auf. Nach der Baustelle Ordner einfach löschen.";
      ordnerPlatz.appendChild(p);
    }
    for (const o of dbOrdner.slice().sort((a, b) => a.name.localeCompare(b.name, "de"))) {
      let eintraege = materialImOrdner(o.id);
      if (worte.length) {
        eintraege = eintraege.filter((m) => worte.every((w) => (m.name + " " + (m.nr || "") + " " + (m.ean || "") + " " + o.name + (istKombi(m) ? " " + kombiBeschreibung(m) : "")).toLowerCase().includes(w)));
        if (!eintraege.length) continue;
      }
      const det = document.createElement("details");
      det.className = "section-card ordner-karte";
      det.open = worte.length > 0 || offeneOrdner.has(o.id);
      det.addEventListener("toggle", () => { if (det.open) offeneOrdner.add(o.id); else offeneOrdner.delete(o.id); });
      det.innerHTML = `<summary><span></span></summary><div class="db-kat-aktionen"></div><ul class="pl-eintraege"></ul>`;
      det.querySelector("summary span").textContent = `📁 ${o.name} (${eintraege.length})`;
      const akt = det.querySelector(".db-kat-aktionen");
      const knopf = (text, cls, fn, aria) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = cls;
        b.textContent = text;
        if (aria) b.setAttribute("aria-label", aria);
        b.addEventListener("click", fn);
        akt.appendChild(b);
      };
      knopf("＋ Material", "btn-link-accent", () => zeigeOrdnerFormular(o, false));
      knopf("＋ Kombination", "btn-link-accent", () => zeigeOrdnerFormular(o, true));
      knopf("✎", "btn-mini", () => {
        const n = prompt("Ordner umbenennen:", o.name);
        if (n && n.trim()) { o.name = n.trim(); speichereOrdner(); aktualisiereAbgeleiteteListen(); render(); }
      }, "Ordner umbenennen");
      knopf("🗑", "btn-mini btn-mini-danger", () => {
        const n = materialImOrdner(o.id).length;
        if (!confirm(`Baustellen-Ordner „${o.name}“${n ? ` mit ${n} Einträgen` : ""} löschen?\n\nBereits erfasste Aufmaße behalten ihre Einträge (auch die Teile von Kombinationen).`)) return;
        loescheOrdner(o.id);
        render();
      }, "Ordner löschen");
      const ul = det.querySelector("ul");
      if (!eintraege.length) {
        const li = document.createElement("li");
        li.className = "hint";
        li.textContent = "Noch kein Material – mit „＋ Material“ (Strahler, LED-Stripe, … per Kategorie) oder „＋ Kombination“ anlegen.";
        ul.appendChild(li);
      }
      for (const m of eintraege) {
        const li = document.createElement("li");
        li.className = "pl-eintrag";
        li.innerHTML = `<div class="info"><strong></strong><small></small></div>
          <span class="komp-aktionen">
            <button type="button" class="btn-mini" aria-label="In Baustellen-Ordner verschieben">📁</button>
            <button type="button" class="btn-mini" aria-label="Bearbeiten">✎</button>
            <button type="button" class="btn-mini btn-mini-danger" aria-label="Löschen">✕</button>
          </span>`;
        li.querySelector("strong").textContent = m.name;
        li.querySelector("small").textContent = kategorieName(m.kat) + " · " + (istKombi(m)
          ? "Kombination: " + kombiBeschreibung(m)
          : [m.einheit || "Stck", m.nr && `Art.-Nr. ${m.nr}`, m.ean && `EAN ${m.ean}`].filter(Boolean).join(" · "));
        li.querySelector('[aria-label="In Baustellen-Ordner verschieben"]').addEventListener("click", () => {
          const info = li.querySelector(".info");
          if (info.querySelector(".db-verschieben")) return;
          const sel = baueVerschiebenAuswahl(m, (ziel) => { if (ziel) offeneOrdner.add(ziel); else offen.add(m.kat); render(); });
          info.appendChild(sel);
          sel.focus();
        });
        li.querySelector('[aria-label="Bearbeiten"]').addEventListener("click", () => {
          const platz = document.createElement("li");
          const fertig = () => { offeneOrdner.add(o.id); render(); };
          platz.appendChild(istKombi(m)
            ? baueKombiFormular({ katId: m.kat, eintrag: m, onSave: fertig, onCancel: render })
            : baueMaterialFormular({ eintrag: m, onSave: fertig, onCancel: render }));
          li.replaceWith(platz);
        });
        li.querySelector('[aria-label="Löschen"]').addEventListener("click", () => {
          if (!confirm(`„${m.name}“ löschen?`)) return;
          dbLoeschen(m.id);
          render();
        });
        ul.appendChild(li);
      }
      ordnerPlatz.appendChild(det);
    }
  }

  let t = null;
  suche.addEventListener("input", () => { clearTimeout(t); t = setTimeout(render, 150); });
  render();

  // Sichern / Wiederherstellen
  view.querySelector(".db-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ kategorien: dbKategorien, material: dbMaterial, ordner: dbOrdner }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Materialdatenbank_${heuteISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  view.querySelector(".db-import").addEventListener("change", async (e) => {
    const datei = e.target.files[0];
    if (!datei) return;
    try {
      const d = JSON.parse(await datei.text());
      let n = 0;
      for (const k of d.kategorien || []) if (!dbKategorien.some((x) => x.id === k.id)) dbKategorien.push({ id: k.id, name: k.name });
      for (const o of d.ordner || []) if (!dbOrdner.some((x) => x.id === o.id)) dbOrdner.push(o);
      speichereOrdner();
      for (const m of d.material || []) {
        const i = dbMaterial.findIndex((x) => x.id === m.id);
        if (i >= 0) dbMaterial[i] = m; else dbMaterial.push(m);
        n++;
      }
      speichereKategorien();
      speichereMaterial();
      alert(`${n} Einträge eingelesen.`);
      render();
    } catch (err) {
      alert("Datei konnte nicht gelesen werden: " + err.message);
    }
    e.target.value = "";
  });
}

/* ---------- Kombinationsprodukte (v18.5) ----------
   Ein Datenbank-Eintrag mit `teile: [{ name, nr, menge }]` – z. B. Strahlergehäuse
   + Leuchtmittel. Wird im Bauaufmaß wie ein normales Produkt ausgewählt; im PDF
   stehen darunter die Teile (Menge = Anzahl × Menge je Stück).
   Anlegbar in den Kategorien aus KOMBI_KATEGORIEN. */
const KOMBI_KATEGORIEN = ["sys:strahler"];

function istKombi(m) {
  return !!(m && Array.isArray(m.teile) && m.teile.length);
}

// Kombination zu einem im Aufmaß gespeicherten Produkt finden (erst über die Id, sonst über den Namen)
function findeKombi(katId, name, id) {
  let m = id ? dbMaterial.find((x) => x.id === id) : null;
  const n = (name || "").trim().toLowerCase();
  if (!m || m.name.trim().toLowerCase() !== n) m = n ? dbMaterial.find((x) => x.kat === katId && x.name.trim().toLowerCase() === n) : null;
  return istKombi(m) ? m : null;
}

function kombiBeschreibung(m) {
  return m.teile.map((t) => `${t.menge > 1 ? t.menge + "× " : ""}${t.name}`).join(" + ");
}

// Suche für ein Teil: eigene Datenbank (alle Kategorien, ohne Kombinationen) + Großhandelskatalog
function sucheKombiTeil(q) {
  const worte = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!worte.length) return [];
  const eigen = dbMaterial
    .filter((m) => !istKombi(m) && worte.every((w) => (m.name + " " + (m.nr || "") + " " + (m.ean || "")).toLowerCase().includes(w)))
    .slice(0, 8)
    .map((m) => ({ name: m.name, nr: m.nr || "", info: kategorieName(m.kat), eigen: true }));
  let katalog = [];
  if (typeof sucheMaterial === "function" && (typeof materialDBReady === "undefined" || materialDBReady)) {
    katalog = sucheMaterial(q, 20).filter((a) => !a._eigen && !eigen.some((e) => e.nr && e.nr === a.n)).slice(0, 10)
      .map((a) => ({ name: a.b, nr: a.n || "", info: "Katalog" + (a.n ? " · Art.-Nr. " + a.n : "") }));
  }
  return eigen.concat(katalog);
}

function baueKombiFormular({ katId, eintrag, onSave, onCancel, ordner }) {
  const form = document.createElement("div");
  form.className = "selected-article produkt-form kombi-form";
  form.innerHTML = `
    <strong class="kf-titel">${eintrag ? "Kombination bearbeiten" : "Neue Kombination"}</strong>
    <p class="hint">Zum Beispiel Strahlergehäuse und Leuchtmittel. Teile aus der Datenbank oder dem Katalog suchen oder frei eintippen.</p>
    <div class="kf-teile"></div>
    <button type="button" class="btn-link-accent kf-plus">＋ weiteres Teil</button>
    <label>Bezeichnung der Kombination
      <input type="text" class="kf-name" placeholder="wird aus den Teilen vorgeschlagen" autocomplete="off">
    </label>
    ${ordnerCheckboxHtml(eintrag ? eintrag.ordner : ordner)}
    <p class="hint kf-fehler" hidden></p>
    <div class="action-bar">
      <button type="button" class="btn btn-primary kf-speichern">Speichern</button>
      <button type="button" class="btn btn-secondary kf-abbrechen">Abbrechen</button>
    </div>`;
  const teile = eintrag ? eintrag.teile.map((t) => ({ ...t })) : [{ name: "", nr: "", menge: 1 }, { name: "", nr: "", menge: 1 }];
  const platz = form.querySelector(".kf-teile");
  const nameInp = form.querySelector(".kf-name");
  let nameManuell = !!eintrag;
  nameInp.value = eintrag ? eintrag.name : "";
  nameInp.addEventListener("input", () => { nameManuell = nameInp.value.trim() !== ""; });
  const vorschlag = () => {
    if (nameManuell) return;
    nameInp.value = teile.filter((t) => t.name.trim()).map((t) => t.name.trim()).join(" + ");
  };

  const renderTeile = () => {
    platz.innerHTML = "";
    teile.forEach((t, i) => {
      const box = document.createElement("div");
      box.className = "kombi-teil";
      box.innerHTML = `
        <div class="stripe-kopf"><span>Teil ${i + 1}</span>${teile.length > 2 ? '<button type="button" class="btn-danger-text" aria-label="Teil entfernen">✕</button>' : ""}</div>
        <input type="search" class="kt-name" placeholder="${i === 0 ? "z. B. Einbaurahmen / Gehäuse" : "z. B. GU10 LED 5W 3000K"}" autocomplete="off">
        <ul class="suggest-list kt-treffer" hidden></ul>
        <small class="kt-nr muted"></small>`;
      const inp = box.querySelector(".kt-name");
      const ul = box.querySelector(".kt-treffer");
      const nrEl = box.querySelector(".kt-nr");
      inp.value = t.name;
      nrEl.textContent = t.nr ? "Art.-Nr. " + t.nr : "";
      let timer = null;
      inp.addEventListener("input", () => {
        t.name = inp.value;
        t.nr = "";
        nrEl.textContent = "";
        vorschlag();
        clearTimeout(timer);
        timer = setTimeout(() => {
          const q = inp.value.trim();
          ul.innerHTML = "";
          if (q.length < 2) { ul.hidden = true; return; }
          const treffer = sucheKombiTeil(q);
          if (!treffer.length) ul.innerHTML = '<li class="no-result">Keine Treffer – Text wird so übernommen</li>';
          for (const x of treffer) {
            const li = document.createElement("li");
            li.innerHTML = `${escapeHtml(x.name)}<small>${x.eigen ? "Datenbank · " : ""}${escapeHtml(x.info)}${x.eigen && x.nr ? " · Art.-Nr. " + escapeHtml(x.nr) : ""}</small>`;
            li.addEventListener("click", () => {
              t.name = x.name;
              t.nr = x.nr;
              inp.value = x.name;
              nrEl.textContent = x.nr ? "Art.-Nr. " + x.nr : "";
              ul.hidden = true;
              vorschlag();
            });
            ul.appendChild(li);
          }
          ul.hidden = false;
        }, 200);
      });
      const del = box.querySelector(".btn-danger-text");
      if (del) del.addEventListener("click", () => { teile.splice(i, 1); vorschlag(); renderTeile(); });
      box.appendChild(baueZaehler("Menge je Stück", t.menge || 1, 1, (v) => { t.menge = v; }));
      platz.appendChild(box);
    });
  };
  renderTeile();
  form.querySelector(".kf-plus").addEventListener("click", () => { teile.push({ name: "", nr: "", menge: 1 }); renderTeile(); });

  form.querySelector(".kf-speichern").addEventListener("click", () => {
    const gueltig = teile.filter((t) => t.name.trim()).map((t) => ({ name: t.name.trim(), nr: (t.nr || "").trim(), menge: t.menge || 1 }));
    const fehler = form.querySelector(".kf-fehler");
    vorschlag();
    const n = nameInp.value.trim();
    if (gueltig.length < 2) { fehler.textContent = "Bitte mindestens zwei Teile angeben."; fehler.hidden = false; return; }
    if (!n) { fehler.textContent = "Bitte eine Bezeichnung eingeben."; fehler.hidden = false; return; }
    const ord = gewaehlterOrdner(form, eintrag ? eintrag.ordner : ordner);
    const doppelt = dbMaterial.find((x) => x.kat === katId && x !== eintrag && (x.ordner || "") === (ord || "") && x.name.trim().toLowerCase() === n.toLowerCase());
    if (doppelt) { fehler.textContent = "In dieser Kategorie gibt es schon einen Eintrag mit dieser Bezeichnung."; fehler.hidden = false; return; }
    let m;
    if (eintrag) { dbAendern(eintrag, { name: n, teile: gueltig }); setzeOrdner(eintrag, ord); m = eintrag; }
    else {
      m = { id: neueId(), kat: katId, name: n, nr: "", ean: "", einheit: "Stck", teile: gueltig };
      if (ord) m.ordner = ord;
      dbMaterial.push(m);
      speichereMaterial();
    }
    onSave(m);
  });
  form.querySelector(".kf-abbrechen").addEventListener("click", () => onCancel && onCancel());
  setTimeout(() => { const f = form.querySelector(".kt-name"); if (f && !eintrag) f.focus(); }, 0);
  return form;
}

// Materialliste (Aufmaß, Packliste, Raum): Zeilen, die einem Kombinationsprodukt entsprechen, durch dessen Teile ersetzen
function loeseKombisAuf(material) {
  for (let i = material.length - 1; i >= 0; i--) {
    const m = material[i];
    if (String(m.id).includes("~")) continue;
    const n = (m.bezeichnung || "").trim().toLowerCase();
    const k = n && dbMaterial.find((x) => istKombi(x) && x.name.trim().toLowerCase() === n);
    if (!k) continue;
    const teile = k.teile.map((t, j) => ({
      id: m.id + "~" + j, bezeichnung: t.name, artikelnummer: t.nr || "", einheit: "Stck",
      menge: rundeMenge((m.menge || 0) * (t.menge || 1)), quelle: "standard", erledigt: false, kombi: k.name
    }));
    material.splice(i, 1, ...teile);
  }
}

/* ---------- Baustellen-Ordner (v19) ----------
   Material, das nur auf einer Baustelle gebraucht wird (z. B. bestimmte Strahler,
   LED-Stripes, Kombinationen). Ein Bauaufmaß wird mit einem Ordner verknüpft
   (`b.ordner`); dann steht dessen Material in allen Auswahlen ganz oben, Material
   anderer Ordner ist ausgeblendet. Ordner samt Inhalt lässt sich wieder löschen. */

function speichereOrdner() {
  try { localStorage.setItem(STORAGE_KEY_ORDNER, JSON.stringify(dbOrdner)); } catch (e) { console.error(e); }
}

function ordnerName(id) {
  const o = dbOrdner.find((x) => x.id === id);
  return o ? o.name : "Baustelle";
}

function legeOrdnerAn(name) {
  const n = (name || "").trim();
  if (!n) return null;
  let o = dbOrdner.find((x) => x.name.toLowerCase() === n.toLowerCase());
  if (!o) {
    o = { id: neueId(), name: n, erstellt: new Date().toISOString() };
    dbOrdner.push(o);
    speichereOrdner();
  }
  return o;
}

function materialImOrdner(id) {
  return dbMaterial.filter((m) => m.ordner === id).sort((a, b) => kategorieName(a.kat).localeCompare(kategorieName(b.kat), "de") || a.name.localeCompare(b.name, "de"));
}

function loescheOrdner(id) {
  dbMaterial = dbMaterial.filter((m) => m.ordner !== id);
  dbOrdner = dbOrdner.filter((o) => o.id !== id);
  speichereMaterial();
  speichereOrdner();
}

// Ordner des gerade geöffneten Bauaufmaßes ("" = keiner, z. B. in der Datenbank-Verwaltung)
function aktiverOrdnerId() {
  const b = (typeof currentBauaufmass !== "undefined" && currentBauaufmass) || (typeof currentAufmass !== "undefined" && currentAufmass) || null;
  const id = b && b.ordner;
  return id && dbOrdner.some((o) => o.id === id) ? id : "";
}

function imKontextSichtbar(m) {
  return !m.ordner || m.ordner === aktiverOrdnerId();
}

// v19.1: Auswahl „Ablegen in“ (allgemein oder Baustellen-Ordner) in den Formularen
function ordnerCheckboxHtml(ordnerId) {
  if (!dbOrdner.length) return "";
  const gueltig = ordnerId && dbOrdner.some((o) => o.id === ordnerId) ? ordnerId : "";
  const opts = [`<option value=""${gueltig ? "" : " selected"}>Allgemeines Material</option>`]
    .concat(dbOrdner.slice().sort((a, b) => a.name.localeCompare(b.name, "de"))
      .map((o) => `<option value="${escapeHtml(o.id)}"${o.id === gueltig ? " selected" : ""}>📁 ${escapeHtml(o.name)} (nur diese Baustelle)</option>`));
  return `<label class="pf-ordner-wrap">Ablegen in <select class="pf-ordner">${opts.join("")}</select></label>`;
}

function gewaehlterOrdner(form, ordnerId) {
  const sel = form.querySelector(".pf-ordner");
  if (!sel) return ordnerId && dbOrdner.some((o) => o.id === ordnerId) ? ordnerId : "";
  return sel.value;
}

// Kleines Inline-Menü zum Verschieben eines Eintrags (allgemein <-> Baustellen-Ordner)
function baueVerschiebenAuswahl(m, onFertig) {
  const sel = document.createElement("select");
  sel.className = "db-verschieben";
  const add = (v, t) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); };
  add("__x__", "Verschieben nach …");
  if (m.ordner) add("", "Allgemeines Material");
  for (const o of dbOrdner.slice().sort((a, b) => a.name.localeCompare(b.name, "de"))) if (o.id !== m.ordner) add(o.id, "📁 " + o.name);
  add("__neu__", "＋ Neuer Baustellen-Ordner…");
  sel.addEventListener("change", () => {
    let ziel = sel.value;
    if (ziel === "__x__") return;
    if (ziel === "__neu__") {
      const o = legeOrdnerAn(prompt("Name des Baustellen-Ordners:") || "");
      if (!o) { sel.value = "__x__"; return; }
      ziel = o.id;
    }
    setzeOrdner(m, ziel);
    onFertig(ziel);
  });
  return sel;
}

function setzeOrdner(m, ordnerId) {
  if (ordnerId) m.ordner = ordnerId; else delete m.ordner;
  speichereMaterial();
}

/* ---------- Aufmaßsoftware: benutzte Einträge / Doppelte ---------- */

// Namen (klein), die irgendwo vorkommen: Materiallisten, Bauaufmaße (Typen, Abdeckungen …), Sterne, Nutzung
function benutzteNamen() {
  const set = new Set();
  const add = (v) => { if (typeof v === "string" && v.trim()) set.add(v.trim().toLowerCase()); };
  const lauf = (x) => {
    if (Array.isArray(x)) x.forEach(lauf);
    else if (x && typeof x === "object") Object.values(x).forEach(lauf);
    else add(x);
  };
  try { (aufmassListe || []).forEach((a) => (a.material || []).forEach((m) => add(m.bezeichnung))); } catch (e) { /* egal */ }
  try { (packlisten || []).forEach((p) => (p.material || []).forEach((m) => add(m.bezeichnung))); } catch (e) { /* egal */ }
  try { (bauaufmasse || []).forEach(lauf); } catch (e) { /* egal */ }
  try { Object.values(sterne || {}).forEach((d) => add(d.bezeichnung)); } catch (e) { /* egal */ }
  try { Object.values(favoritenCounts || {}).forEach((d) => { if (d.count > 0) add(d.bezeichnung); }); } catch (e) { /* egal */ }
  return set;
}

function dbNormName(n) {
  return String(n || "").toLowerCase().replace(/[.,;:()\[\]\-_/]+/g, " ").replace(/\s+/g, " ").trim();
}

// Gruppen gleicher Einträge (gleicher Name, gleiche Art.-Nr. oder gleiche EAN) im allgemeinen Material
function findeDoppelte() {
  const liste = dbMaterial.filter((m) => !m.ordner && !istKombi(m));
  const eltern = new Map(liste.map((m) => [m.id, m.id]));
  const finde = (id) => { while (eltern.get(id) !== id) id = eltern.get(id); return id; };
  const verbinde = (a, b) => { const x = finde(a), y = finde(b); if (x !== y) eltern.set(y, x); };
  const nachSchluessel = new Map();
  for (const m of liste) {
    for (const k of ["n:" + dbNormName(m.name), m.nr ? "r:" + m.nr.trim() : "", m.ean ? "e:" + m.ean.trim() : ""]) {
      if (!k || k === "n:") continue;
      if (nachSchluessel.has(k)) verbinde(nachSchluessel.get(k), m.id); else nachSchluessel.set(k, m.id);
    }
  }
  const gruppen = new Map();
  for (const m of liste) { const r = finde(m.id); if (!gruppen.has(r)) gruppen.set(r, []); gruppen.get(r).push(m); }
  return [...gruppen.values()].filter((g) => g.length > 1);
}

function renderDoppelte(liste, info, neuZeichnen) {
  const gruppen = findeDoppelte();
  info.textContent = gruppen.length
    ? `${gruppen.length} mögliche Doppel-Einträge (gleicher Name, gleiche Art.-Nr. oder EAN). „Zusammenführen“ behält den Eintrag mit den meisten Angaben.`
    : "Keine doppelten Einträge gefunden. 👍";
  const wertung = (m) => (m.nr ? 2 : 0) + (m.ean ? 2 : 0) + (m.kat === KAT_EIGENE ? 0 : 1) + nutzung("standard:" + m.name) / 1000;
  for (const g of gruppen) {
    g.sort((a, b) => wertung(b) - wertung(a));
    const karte = document.createElement("div");
    karte.className = "section-card doppelt-karte";
    const ul = document.createElement("ul");
    ul.className = "pl-eintraege";
    g.forEach((m, i) => {
      const li = document.createElement("li");
      li.className = "pl-eintrag";
      li.innerHTML = `<div class="info"><strong></strong><small></small></div>`;
      li.querySelector("strong").textContent = (i === 0 ? "✓ " : "") + m.name;
      li.querySelector("small").textContent = [kategorieName(m.kat), m.einheit, m.nr && "Art.-Nr. " + m.nr, m.ean && "EAN " + m.ean].filter(Boolean).join(" · ");
      ul.appendChild(li);
    });
    karte.appendChild(ul);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.textContent = `Zusammenführen (behält „${g[0].name}“)`;
    btn.addEventListener("click", () => {
      const behalte = g[0];
      for (const m of g.slice(1)) {
        if (!behalte.nr && m.nr) behalte.nr = m.nr;
        if (!behalte.ean && m.ean) behalte.ean = m.ean;
      }
      const weg = new Set(g.slice(1).map((m) => m.id));
      dbMaterial = dbMaterial.filter((m) => !weg.has(m.id));
      delete behalte._imp;
      speichereMaterial();
      neuZeichnen();
    });
    karte.appendChild(btn);
    liste.appendChild(karte);
  }
}
