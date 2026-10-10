"use strict";

/* ============================================================
   Gemeinsamer Kundenstamm (seit am2-v6)
   Gleiche Firestore-Sammlung `kundenstamm` und gleiche Regeln wie die
   Stundenzettel-App (ab v21): Alle angemeldeten Kollegen lesen und erweitern
   ihn. Doc-ID = encodeURIComponent(name.trim().toLowerCase()),
   Felder: key, name, address (EINE Zeile "Straße, PLZ Ort, Tel. …"), t, by, del.
   Schreiben immer mit set(..., {merge:true}); Löschen = weich (del:true);
   eine vorhandene Adresse wird nie durch eine leere überschrieben.
   Lokale Kopie in localStorage (am2_kundenstamm) für den Offline-Start – sie
   gehört NICHT zum kontenbezogenen Cloud-Sync (cloudsync.js) und bleibt auch
   beim Kontowechsel erhalten, da der Stamm für alle gleich ist.
   Wird NACH cloudsync.js geladen.
   ============================================================ */

const KUNDEN_COLL = "kundenstamm";
const KUNDEN_LS_KEY = "am2_kundenstamm";

let ksKunden = {};      // key -> { name, address, t }   (lokale Kopie)
let ksRemote = {};      // key -> { address, del }       (was in der Cloud liegt)
let ksSyncedOnce = false;
let ksAbo = null;
let ksFehler = "";
let ksVerwaltungRender = null; // Neuzeichnen der Verwaltungsansicht (Einstellungen), falls offen

const custKey = (name) => (name || "").trim().toLowerCase();

/* ---------- Lokale Kopie ---------- */

function ksLadeLokal() {
  try {
    const raw = localStorage.getItem(KUNDEN_LS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    ksKunden = obj && typeof obj === "object" ? obj : {};
  } catch (e) { ksKunden = {}; }
}
function ksSpeichereLokal() {
  try { localStorage.setItem(KUNDEN_LS_KEY, JSON.stringify(ksKunden)); } catch (e) { console.error("Kundenstamm lokal nicht gespeichert", e); }
}
ksLadeLokal();

/* ---------- Adresse: Einzelfelder <-> eine Zeile ---------- */

function ksAdresseZusammen(k) {
  const teile = [];
  if ((k.strasse || "").trim()) teile.push(k.strasse.trim());
  if ((k.plzOrt || "").trim()) teile.push(k.plzOrt.trim());
  if ((k.telefon || "").trim()) teile.push("Tel. " + k.telefon.trim());
  return teile.join(", ");
}

// "Hauptstraße 1, 49832 Freren, Tel. 0591 123456" -> { strasse, plzOrt, telefon }
function ksAdresseAufteilen(zeile) {
  const r = { strasse: "", plzOrt: "", telefon: "" };
  for (const roh of String(zeile || "").split(",")) {
    const t = roh.trim();
    if (!t) continue;
    if (/^(tel|telefon|fon|mobil|handy)\b\.?:?/i.test(t)) r.telefon = t.replace(/^(tel|telefon|fon|mobil|handy)\b\.?:?\s*/i, "").trim();
    else if (/^(D-|DE-)?\d{5}\b/.test(t) && !r.plzOrt) r.plzOrt = t;
    else r.strasse = r.strasse ? r.strasse + ", " + t : t;
  }
  return r;
}

/* ---------- Firestore ---------- */

function ksRef(key) { return cloud.db.collection(KUNDEN_COLL).doc(encodeURIComponent(key)); }
function ksBenutzer() { return typeof cloud !== "undefined" && cloud.db && cloud.auth && cloud.auth.currentUser; }

function ksPush(key, geloescht) {
  const user = ksBenutzer(); if (!user) return; // offline/abgemeldet: später per ksPushLocal()
  const by = user.email || user.uid;
  let p;
  if (geloescht) {
    ksRemote[key] = { address: "", del: true };
    p = ksRef(key).set({ key, del: true, t: Date.now(), by }, { merge: true });
  } else {
    const c = ksKunden[key]; if (!c) return;
    ksRemote[key] = { address: c.address || "", del: false };
    p = ksRef(key).set({ key, name: c.name, address: c.address || "", t: c.t || Date.now(), by, del: false }, { merge: true });
  }
  p.catch((err) => ksMeldeFehler(err));
}

function ksMeldeFehler(err) {
  if (err && err.code === "permission-denied") {
    ksFehler = "Kundenstamm noch nicht freigeschaltet (Firestore-Regel fehlt). Die Kunden bleiben vorerst nur auf diesem Gerät.";
  } else if (err && (err.code === "unavailable" || err.code === "deadline-exceeded")) {
    ksFehler = ""; // offline: wird beim nächsten Start/Online-Sein nachgeholt
    return;
  } else {
    ksFehler = "Kundenstamm: " + ((err && err.message) || err);
  }
  console.warn(ksFehler);
  if (ksVerwaltungRender) ksVerwaltungRender();
  if (!ksHinweisGezeigt) {
    ksHinweisGezeigt = true;
    const el = document.createElement("div");
    el.className = "update-banner sync-hinweis";
    el.innerHTML = `<span></span><button class="btn-danger-text" style="color:#fff" aria-label="Schließen">${ic("x")}</button>`;
    el.querySelector("span").textContent = ksFehler;
    el.querySelector("button").addEventListener("click", () => el.remove());
    document.body.appendChild(el);
  }
}
let ksHinweisGezeigt = false;

function ksStarteSync() {
  if (ksAbo || !ksBenutzer()) return;
  ksAbo = cloud.db.collection(KUNDEN_COLL).onSnapshot((snap) => {
    ksFehler = "";
    snap.docChanges().forEach((ch) => {
      const x = ch.doc.data() || {};
      let key = x.key;
      if (!key) { try { key = decodeURIComponent(ch.doc.id); } catch (e) { key = ch.doc.id; } }
      if (ch.type === "removed") { delete ksRemote[key]; return; }
      ksRemote[key] = { address: x.address || "", del: !!x.del };
      if (x.del) { delete ksKunden[key]; return; }
      if (!x.name) return;
      const cur = ksKunden[key];
      // leere Cloud-Adresse überschreibt keine lokale Adresse (wird danach hochgeladen)
      ksKunden[key] = { name: x.name, address: x.address || (cur && cur.address) || "", t: x.t || 0 };
    });
    ksSpeichereLokal();
    if (ksVerwaltungRender) ksVerwaltungRender();
    if (!snap.metadata.fromCache && !ksSyncedOnce) { ksSyncedOnce = true; ksPushLocal(); }
  }, (err) => { ksAbo = null; ksMeldeFehler(err); });
}

function ksBeendeSync() {
  if (ksAbo) { try { ksAbo(); } catch (e) { /* egal */ } }
  ksAbo = null; ksSyncedOnce = false; ksRemote = {};
}

// Lokal vorhandene Kunden hochladen, die in der Cloud fehlen oder dort keine Adresse haben.
// Als gelöscht markierte werden nicht wiederbelebt.
function ksPushLocal() {
  const user = ksBenutzer(); if (!user || !ksSyncedOnce) return;
  const by = user.email || user.uid;
  const ops = [];
  Object.entries(ksKunden).forEach(([key, c]) => {
    const r = ksRemote[key];
    if (!r) ops.push([key, { key, name: c.name, address: c.address || "", t: c.t || Date.now(), by, del: false }]);
    else if (!r.del && !r.address && c.address) ops.push([key, { address: c.address, t: Date.now(), by }]);
  });
  for (let i = 0; i < ops.length; i += 400) {
    const batch = cloud.db.batch();
    ops.slice(i, i + 400).forEach(([key, data]) => batch.set(ksRef(key), data, { merge: true }));
    batch.commit().catch(ksMeldeFehler);
  }
}

/* ---------- Kunden ändern ---------- */

// Legt den Kunden an bzw. ergänzt die Adresse (nie durch eine leere ersetzen).
function upsertCustomer(name, address) {
  name = (name || "").trim(); if (!name) return;
  address = (address || "").trim();
  const key = custKey(name), cur = ksKunden[key];
  if (!cur) ksKunden[key] = { name, address, t: Date.now() };
  else if (address && address !== cur.address) { cur.address = address; cur.t = Date.now(); }
  else return;
  ksSpeichereLokal(); ksPush(key);
  if (ksVerwaltungRender) ksVerwaltungRender();
}

// Gibt "ok" zurück; bei bereits vorhandenem neuem Namen muss der Aufrufer vorher bestätigt haben.
function ksUmbenennen(oldKey, newName, address) {
  const c = ksKunden[oldKey]; if (!c) return;
  newName = (newName || "").trim(); address = (address || "").trim();
  if (!newName) return;
  const newKey = custKey(newName);
  if (newKey === oldKey) { c.name = newName; c.address = address; c.t = Date.now(); }
  else {
    const ziel = ksKunden[newKey];
    if (ziel) { if (!ziel.address && (address || c.address)) ziel.address = address || c.address; ziel.name = ziel.name || newName; ziel.t = Date.now(); }
    else ksKunden[newKey] = { name: newName, address: address || c.address || "", t: Date.now() };
    delete ksKunden[oldKey];
  }
  ksSpeichereLokal(); ksPush(newKey); if (newKey !== oldKey) ksPush(oldKey, true);
}

function ksLoesche(key) {
  if (!ksKunden[key]) return;
  delete ksKunden[key];
  ksSpeichereLokal(); ksPush(key, true);
}

// Aus einem Aufmaß/Bauaufmaß (kunde-Objekt) in den Stamm übernehmen
function kundenstammErfassen(kunde) {
  if (!kunde || !(kunde.name || "").trim()) return;
  upsertCustomer(kunde.name, ksAdresseZusammen(kunde));
}

/* ---------- Vorschlagsliste ---------- */

function ksTreffer(q) {
  const ql = (q || "").trim().toLowerCase(); if (!ql) return [];
  const starts = [], contains = [];
  Object.values(ksKunden).forEach((c) => {
    const n = c.name.toLowerCase();
    if (n.startsWith(ql)) starts.push(c);
    else if (n.includes(ql) || (c.address || "").toLowerCase().includes(ql)) contains.push(c);
  });
  const byName = (a, b) => a.name.localeCompare(b.name, "de");
  return starts.sort(byName).concat(contains.sort(byName)).slice(0, 8);
}

/* Hängt Vorschlagsliste + Adressübernahme an ein Kundenformular.
   p = { name, ansprechpartner, strasse, plzOrt, telefon } (Element-IDs), kunde = Objekt (a.kunde / b.kunde) */
function bindeKundenstamm(p, kunde) {
  const el = {};
  for (const k of Object.keys(p)) el[k] = document.getElementById(p[k]);
  if (!el.name || !el.strasse) return;
  const label = el.name.closest("label") || el.name.parentElement;
  label.classList.add("autocomplete");
  const liste = document.createElement("ul");
  liste.className = "suggest-list ks-liste";
  liste.hidden = true;
  label.appendChild(liste);

  // Zu welchem Kunden gehört der Inhalt der Adressfelder?
  let besitzer = ksAdresseZusammen(kunde) ? custKey(kunde.name) : null;
  let blurTimer = null;

  const setze = (feld, wert) => {
    if (!el[feld]) return;
    el[feld].value = wert;
    el[feld].dispatchEvent(new Event("input", { bubbles: true }));
  };
  const schliesse = () => { liste.hidden = true; liste.innerHTML = ""; };

  const waehle = (c) => {
    const key = custKey(c.name);
    const a = ksAdresseAufteilen(c.address);
    if (!c.address && besitzer === null && ksAdresseZusammen({ strasse: el.strasse.value, plzOrt: el.plzOrt.value, telefon: el.telefon.value })) {
      // Kunde ohne Adresse im Stamm, aber Adresse schon von Hand eingetippt -> behalten und in den Stamm schreiben
    } else {
      setze("strasse", a.strasse); setze("plzOrt", a.plzOrt); setze("telefon", a.telefon);
      if (el.ansprechpartner && besitzer !== key) setze("ansprechpartner", "");
    }
    besitzer = key;
    setze("name", c.name);
    el.name.dispatchEvent(new Event("change", { bubbles: true }));
    schliesse();
    kundenstammErfassen(kunde);
  };

  const neuAnlegen = (name) => {
    upsertCustomer(name, "");
    besitzer = null;
    setze("strasse", ""); setze("plzOrt", ""); setze("telefon", "");
    if (el.ansprechpartner) setze("ansprechpartner", "");
    setze("name", ksKunden[custKey(name)].name);
    schliesse();
    setTimeout(() => el.strasse.focus(), 30);
  };

  const zeichne = () => {
    const q = el.name.value.trim();
    liste.innerHTML = "";
    if (!q) { liste.hidden = true; return; }
    const treffer = ksTreffer(q);
    for (const c of treffer) {
      const li = document.createElement("li");
      li.innerHTML = `<span></span><small></small>`;
      li.firstChild.textContent = c.name;
      li.querySelector("small").textContent = c.address || "";
      if (!c.address) li.querySelector("small").remove();
      li.addEventListener("click", () => waehle(c));
      liste.appendChild(li);
    }
    if (!ksKunden[custKey(q)]) {
      const li = document.createElement("li");
      li.className = "ks-neu";
      li.innerHTML = `${ic("plus")}<span></span>`;
      li.querySelector("span").textContent = `„${q}“ als neuen Kunden übernehmen`;
      li.addEventListener("click", () => neuAnlegen(q));
      liste.appendChild(li);
    }
    liste.hidden = liste.children.length === 0;
  };

  // Fokus im Feld halten, wenn die Liste angetippt wird (wichtig fürs iPhone)
  liste.addEventListener("mousedown", (e) => e.preventDefault());
  liste.addEventListener("touchstart", () => clearTimeout(blurTimer), { passive: true });
  el.name.addEventListener("input", zeichne);
  el.name.addEventListener("focus", zeichne);
  el.name.addEventListener("blur", () => { blurTimer = setTimeout(schliesse, 250); });

  // Adresse nachtragen: sofort in den Stamm, wenn der Kunde schon bekannt ist
  for (const f of ["strasse", "plzOrt", "telefon"]) {
    el[f].addEventListener("change", () => {
      if (besitzer === null && ksKunden[custKey(kunde.name)]) besitzer = custKey(kunde.name);
      if (ksKunden[custKey(kunde.name)]) kundenstammErfassen(kunde);
    });
  }
  // Name von Hand geändert: Adresse im Feld gehört dann nicht mehr automatisch zum neuen Namen
  el.name.addEventListener("input", () => {
    if (besitzer && custKey(el.name.value) !== besitzer) besitzer = null;
  });
}

/* ---------- Verwaltung (Einstellungen → Kundenstamm) ---------- */

function renderKundenstammEinstellungen(host) {
  if (!host) return;
  host.innerHTML = `
    <details class="section-card ks-verwaltung">
      <summary><span class="ht ht-violet">${ic("users")}</span><span>Kundenstamm <span class="ks-anzahl"></span></span></summary>
      <p class="hint">Gemeinsam mit der Stundenzettel-App und allen Kollegen. Kunden werden beim Eintippen im Kundenfeld vorgeschlagen.</p>
      <p class="hint ks-fehler" hidden></p>
      <input type="search" class="ks-suche" placeholder="Kunden suchen …" autocomplete="off">
      <ul class="card-list ks-kartenliste"></ul>
    </details>`;
  const suche = host.querySelector(".ks-suche");
  const ul = host.querySelector(".ks-kartenliste");
  const anzahl = host.querySelector(".ks-anzahl");
  const fehler = host.querySelector(".ks-fehler");
  let bearbeite = null;

  const zeichne = () => {
    if (!document.body.contains(host)) { ksVerwaltungRender = null; return; }
    const alle = Object.entries(ksKunden).sort((a, b) => a[1].name.localeCompare(b[1].name, "de"));
    anzahl.textContent = `· ${alle.length}`;
    fehler.hidden = !ksFehler; fehler.textContent = ksFehler;
    const q = suche.value.trim().toLowerCase();
    const liste = q ? alle.filter(([, c]) => c.name.toLowerCase().includes(q) || (c.address || "").toLowerCase().includes(q)) : alle;
    ul.innerHTML = "";
    if (!liste.length) {
      const li = document.createElement("li");
      li.className = "hint"; li.textContent = alle.length ? "Keine Treffer." : "Noch keine Kunden im Stamm.";
      ul.appendChild(li); return;
    }
    for (const [key, c] of liste.slice(0, 100)) {
      const li = document.createElement("li");
      li.className = "ks-zeile";
      if (bearbeite === key) {
        li.innerHTML = `<input class="ks-n" type="text" placeholder="Name"><input class="ks-a" type="text" placeholder="Straße, PLZ Ort, Tel. …"><div class="ks-knoepfe"><button type="button" class="btn btn-primary ks-ok">Speichern</button><button type="button" class="btn ks-abbr">Abbrechen</button></div>`;
        li.querySelector(".ks-n").value = c.name;
        li.querySelector(".ks-a").value = c.address || "";
        li.querySelector(".ks-abbr").addEventListener("click", () => { bearbeite = null; zeichne(); });
        li.querySelector(".ks-ok").addEventListener("click", () => {
          const n = li.querySelector(".ks-n").value.trim(), a = li.querySelector(".ks-a").value.trim();
          if (!n) return;
          const nk = custKey(n);
          if (nk !== key && ksKunden[nk] && !confirm(`„${ksKunden[nk].name}“ gibt es schon. Beide zusammenführen? (Vorhandene Adresse bleibt, fehlende wird ergänzt.)`)) return;
          ksUmbenennen(key, n, a);
          bearbeite = null; zeichne();
        });
      } else {
        li.innerHTML = `<div class="info"><p class="kunde"></p><p class="meta"></p></div><button type="button" class="ks-ib ks-edit" aria-label="Bearbeiten">${ic("edit")}</button><button type="button" class="ks-ib ks-del" aria-label="Löschen">${ic("trash")}</button>`;
        li.querySelector(".kunde").textContent = c.name;
        li.querySelector(".meta").textContent = c.address || "(keine Adresse)";
        li.querySelector(".ks-edit").addEventListener("click", () => { bearbeite = key; zeichne(); });
        li.querySelector(".ks-del").addEventListener("click", () => {
          if (confirm(`„${c.name}“ aus dem gemeinsamen Kundenstamm löschen?\n\nDas gilt für alle Kollegen und auch in der Stundenzettel-App.`)) { ksLoesche(key); zeichne(); }
        });
      }
      ul.appendChild(li);
    }
    if (liste.length > 100) {
      const li = document.createElement("li");
      li.className = "hint"; li.textContent = `… ${liste.length - 100} weitere – bitte Suche nutzen.`;
      ul.appendChild(li);
    }
  };
  suche.addEventListener("input", () => { bearbeite = null; zeichne(); });
  ksVerwaltungRender = zeichne;
  zeichne();
}

/* ---------- Start ---------- */

if (typeof cloud !== "undefined" && cloud.auth) {
  cloud.auth.onAuthStateChanged((user) => {
    if (user) ksStarteSync(); else ksBeendeSync();
  });
}
window.addEventListener("online", () => { if (ksBenutzer()) { if (!ksAbo) ksStarteSync(); else if (ksSyncedOnce) ksPushLocal(); } });
