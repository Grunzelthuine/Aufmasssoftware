"use strict";

/* ============================================================
   Gemeinsamer Kundenstamm (seit am2-v6)
   Gleiche Firestore-Sammlung `kundenstamm` und gleiche Regeln wie die
   Stundenzettel-App (ab v21): Alle angemeldeten Kollegen lesen und erweitern
   ihn. Doc-ID = encodeURIComponent(name.trim().toLowerCase()),
   Felder: key, name, address (EINE Zeile "Straße, PLZ Ort, Tel. …"), t, by, del,
   sites (v7.12: Baustellen je Kunde wie Stundenzettel-App v32:
   [{ id, name, address, done, t }] – wird nur mitgeschrieben, wenn hier eine
   Baustelle angelegt wurde; sonst bleibt das Feld in der Cloud unangetastet).
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

function ksPush(key, geloescht, mitSites) {
  const user = ksBenutzer(); if (!user) return; // offline/abgemeldet: später per ksPushLocal()
  const by = user.email || user.uid;
  let p;
  if (geloescht) {
    ksRemote[key] = { address: "", del: true };
    p = ksRef(key).set({ key, del: true, t: Date.now(), by }, { merge: true });
  } else {
    const c = ksKunden[key]; if (!c) return;
    ksRemote[key] = { address: c.address || "", del: false };
    const daten = { key, name: c.name, address: c.address || "", t: c.t || Date.now(), by, del: false };
    if (mitSites && Array.isArray(c.sites)) daten.sites = c.sites;
    p = ksRef(key).set(daten, { merge: true });
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
      const sites = Array.isArray(x.sites) ? x.sites : (cur && cur.sites);
      if (Array.isArray(sites)) ksKunden[key].sites = sites;
    });
    ksSpeichereLokal();
    if (ksVerwaltungRender) ksVerwaltungRender();
    if (window.SpeckmannStandort) SpeckmannStandort.refresh(); // neue Adressen für „Kunde in der Nähe“ vorab abgleichen
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
    if (ziel) {
      if (!ziel.address && (address || c.address)) ziel.address = address || c.address; ziel.name = ziel.name || newName; ziel.t = Date.now();
      if (Array.isArray(c.sites) && c.sites.length) ziel.sites = [...(ziel.sites || []), ...c.sites.filter((x) => !(ziel.sites || []).some((y) => y.id === x.id))];
    }
    else ksKunden[newKey] = { name: newName, address: address || c.address || "", t: Date.now(), ...(Array.isArray(c.sites) && c.sites.length ? { sites: c.sites } : {}) };
    delete ksKunden[oldKey];
  }
  ksSpeichereLokal(); ksPush(newKey, false, true); if (newKey !== oldKey) ksPush(oldKey, true);
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

/* ---------- Baustellen je Kunde (v7.12, wie Stundenzettel-App v32) ---------- */

function ksAktiveBaustellen(c) { return (c && Array.isArray(c.sites) ? c.sites : []).filter((x) => x && x.name && !x.done); }
function ksBaustelleText(st) { return st.name + (st.address ? ", " + st.address.replace(/,?\s*(Tel\.?|Telefon|Mobil|Handy)\b.*$/i, "") : ""); }

/* Kundenfeld wie in der Stundenzettel-App: EIN Feld „Kunde“ mit Vorschlägen (auch
   Baustellen der Kunden), Pin „Kunde in der Nähe“, Baustellen-Chips + „Baustelle“,
   darunter EINE Adresszeile (wird auf Straße / PLZ Ort / Telefon verteilt, damit PDF
   und Daten unverändert bleiben). Präfix x = "f" (Aufmaß) oder "b" (Bauaufmaß).
   kunde = a.kunde / b.kunde, obj = a / b (obj.baustelle = Text fürs PDF,
   obj.baustelleId / obj.baustelleKunde = gewählte Baustelle aus dem Kundenstamm). */
function bindeKundenstamm(x, kunde, obj) {
  const $ = (id) => document.getElementById(x + "_" + id);
  const el = {
    name: $("kundeName"), ansprechpartner: $("ansprechpartner"), strasse: $("strasse"), plzOrt: $("plzOrt"),
    telefon: $("telefon"), baustelle: $("baustelle"), adresse: $("adresse"), adresseBox: $("adresseBox"),
    adresseLabel: $("adresseLabel"), siteRow: $("siteRow"), siteForm: $("siteForm"), siteTitel: $("siteFormTitel"),
    siteName: $("siteName"), siteAdresse: $("siteAdresse")
  };
  if (!el.name || !el.adresse) return;
  const label = el.name.closest("label") || el.name.parentElement;
  label.classList.add("autocomplete");
  const liste = document.createElement("ul");
  liste.className = "suggest-list ks-liste";
  liste.hidden = true;
  label.appendChild(liste);

  const setze = (feld, wert) => {
    if (!el[feld]) return;
    el[feld].value = wert;
    el[feld].dispatchEvent(new Event("input", { bubbles: true }));
  };
  const schliesse = () => { liste.hidden = true; liste.innerHTML = ""; };
  const kundeJetzt = () => ksKunden[custKey(el.name.value)];

  // Zu welchem Kunden gehört der Inhalt des Adressfelds?
  let besitzer = ksAdresseZusammen(kunde) ? custKey(kunde.name) : null;
  let blurTimer = null;
  el.adresse.value = ksAdresseZusammen(kunde);

  // Adresszeile -> Einzelfelder
  const adresseVerteilen = () => {
    const a = ksAdresseAufteilen(el.adresse.value);
    setze("strasse", a.strasse); setze("plzOrt", a.plzOrt); setze("telefon", a.telefon);
  };
  el.adresse.addEventListener("input", () => { besitzer = custKey(el.name.value) || null; adresseVerteilen(); });
  el.adresse.addEventListener("change", () => { if (kundeJetzt()) kundenstammErfassen(kunde); });

  const setzeAdresse = (zeile) => { el.adresse.value = zeile || ""; adresseVerteilen(); };

  const aktualisiereAdressfeld = () => {
    const name = el.name.value.trim();
    el.adresseBox.hidden = !name;
    const known = kundeJetzt();
    el.adresseLabel.textContent = !known ? "Adresse (Neukunde) — Straße/Ort, Telefon"
      : known.address ? "Adresse (aus Kundenstamm – bei Bedarf ergänzen/ändern)"
      : "Adresse fehlt im Kundenstamm noch – hier eintragen, wird übernommen";
  };

  /* --- Baustelle --- */
  const waehleBaustelle = (st, key) => {
    obj.baustelleId = st ? st.id : "";
    obj.baustelleKunde = st ? key : "";
    setze("baustelle", st ? ksBaustelleText(st) : "");
    el.baustelle.dispatchEvent(new Event("change", { bubbles: true }));
    renderBaustellen();
  };
  const renderBaustellen = () => {
    const name = el.name.value.trim();
    const row = el.siteRow;
    if (!name) { row.hidden = true; row.innerHTML = ""; return; }
    const key = custKey(name);
    const sites = ksAktiveBaustellen(ksKunden[key]);
    const aktivId = obj.baustelleKunde === key ? obj.baustelleId : "";
    let html = sites.map((st) => `<button type="button" class="qbtn site-chip${aktivId === st.id ? " active" : ""}" data-site="${escapeHtml(st.id)}">${escapeHtml(st.name)}</button>`).join("");
    html += `<button type="button" class="qbtn site-add">${ic("plus")}Baustelle</button>`;
    const text = (obj.baustelle || "").trim();
    if (text) html += `<div class="site-info">${ic("pin")}<span>${escapeHtml(text)}</span><button type="button" class="site-weg" aria-label="Baustelle entfernen">${ic("x")}</button></div>`;
    row.innerHTML = html;
    row.hidden = false;
  };
  el.siteRow.addEventListener("click", (ev) => {
    if (ev.target.closest(".site-add")) { zeigeBaustellenForm(); return; }
    if (ev.target.closest(".site-weg")) { waehleBaustelle(null); return; }
    const chip = ev.target.closest(".site-chip");
    if (!chip) return;
    const key = custKey(el.name.value);
    const st = ksAktiveBaustellen(ksKunden[key]).find((s) => s.id === chip.dataset.site);
    waehleBaustelle(obj.baustelleId === chip.dataset.site && obj.baustelleKunde === key ? null : st, key);
  });
  const zeigeBaustellenForm = () => {
    const name = el.name.value.trim();
    if (!name) { ksToast("Bitte zuerst den Kunden eintragen."); el.name.focus(); return; }
    el.siteName.value = ""; el.siteAdresse.value = "";
    el.siteTitel.textContent = `Neue Baustelle für „${name}“`;
    el.siteForm.hidden = false;
    el.siteName.focus();
  };
  $("siteAbbr").addEventListener("click", () => { el.siteForm.hidden = true; });
  $("siteOk").addEventListener("click", () => {
    const custName = el.name.value.trim();
    const siteName = el.siteName.value.trim();
    if (!custName) { ksToast("Bitte zuerst den Kunden eintragen."); return; }
    if (!siteName) { ksToast("Bitte eine Bezeichnung eintragen, z. B. „Neubau“."); el.siteName.focus(); return; }
    const key = custKey(custName);
    if (!ksKunden[key]) upsertCustomer(custName, el.adresse.value);
    const c = ksKunden[key];
    if (!c) return;
    const vorhanden = ksAktiveBaustellen(c).find((s) => s.name.toLowerCase() === siteName.toLowerCase());
    if (vorhanden) {
      el.siteForm.hidden = true;
      waehleBaustelle(vorhanden, key);
      ksToast("Diese Baustelle gibt es schon – ausgewählt.");
      return;
    }
    const st = { id: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name: siteName, address: el.siteAdresse.value.trim(), done: false, t: Date.now() };
    c.sites = [...(Array.isArray(c.sites) ? c.sites : []), st];
    c.t = Date.now();
    ksSpeichereLokal();
    ksPush(key, false, true);
    if (ksVerwaltungRender) ksVerwaltungRender();
    el.siteForm.hidden = true;
    waehleBaustelle(st, key);
    ksToast(`Baustelle „${siteName}“ angelegt${ksBenutzer() ? " – auch in der Stunden-App sichtbar" : ""}.`);
  });

  /* --- Kunde wählen --- */
  const waehle = (c, baustelle) => {
    const key = custKey(c.name);
    if (!c.address && besitzer === null && el.adresse.value.trim()) {
      // Kunde ohne Adresse im Stamm, aber Adresse schon von Hand eingetippt -> behalten und in den Stamm schreiben
    } else {
      setzeAdresse(c.address || "");
      if (el.ansprechpartner && besitzer !== key) setze("ansprechpartner", "");
    }
    besitzer = key;
    setze("name", c.name);
    el.name.dispatchEvent(new Event("change", { bubbles: true }));
    schliesse();
    kundenstammErfassen(kunde);
    if (baustelle) waehleBaustelle(baustelle, key);
    else if (obj.baustelleId && obj.baustelleKunde !== key) waehleBaustelle(null);
    aktualisiereAdressfeld();
    renderBaustellen();
  };

  const neuAnlegen = (name) => {
    upsertCustomer(name, "");
    besitzer = null;
    setzeAdresse("");
    if (el.ansprechpartner) setze("ansprechpartner", "");
    setze("name", ksKunden[custKey(name)].name);
    schliesse();
    if (obj.baustelleId) waehleBaustelle(null);
    aktualisiereAdressfeld();
    renderBaustellen();
    setTimeout(() => el.adresse.focus(), 30);
  };

  const zeichne = () => {
    const q = el.name.value.trim();
    const ql = q.toLowerCase();
    liste.innerHTML = "";
    if (!q) { liste.hidden = true; return; }
    const treffer = ksTreffer(q);
    const exakt = ksKunden[custKey(q)];
    if (exakt && treffer.length <= 1 && !ksAktiveBaustellen(exakt).length) { liste.hidden = true; return; }
    // Kunden + deren Baustellen; zusätzlich Baustellen anderer Kunden, die zu Name/Ort passen
    const eintraege = [];
    const drin = new Set();
    for (const c of treffer) {
      eintraege.push({ c }); drin.add(custKey(c.name));
      for (const st of ksAktiveBaustellen(c)) eintraege.push({ c, st });
    }
    for (const c of Object.values(ksKunden)) {
      if (drin.has(custKey(c.name))) continue;
      for (const st of ksAktiveBaustellen(c)) {
        if ((st.name || "").toLowerCase().includes(ql) || (st.address || "").toLowerCase().includes(ql)) eintraege.push({ c, st });
      }
    }
    for (const { c, st } of eintraege.slice(0, 12)) {
      const li = document.createElement("li");
      if (st) {
        li.className = "ks-site";
        li.innerHTML = `<span></span> <span class="s-site"></span><small></small>`;
        li.firstChild.textContent = c.name;
        li.querySelector(".s-site").textContent = st.name;
        li.querySelector("small").textContent = st.address || "";
        if (!st.address) li.querySelector("small").remove();
        li.addEventListener("click", () => waehle(c, st));
      } else {
        li.innerHTML = `<span></span><small></small>`;
        li.firstChild.textContent = c.name;
        li.querySelector("small").textContent = c.address || "";
        if (!c.address) li.querySelector("small").remove();
        li.addEventListener("click", () => waehle(c));
      }
      liste.appendChild(li);
    }
    if (!exakt) {
      const li = document.createElement("li");
      li.className = "ks-neu";
      li.innerHTML = `${ic("plus")}<span></span>`;
      li.querySelector("span").textContent = `„${q}“ als neuen Kunden übernehmen`;
      li.addEventListener("click", () => neuAnlegen(q));
      liste.appendChild(li);
    }
    liste.hidden = liste.children.length === 0;
  };

  // v7.2: Standort „Kunde in der Nähe“ (Pin-Knopf neben dem Kundenfeld)
  const st = ksStandortTeile();
  if (st) {
    const wrap = document.createElement("div");
    wrap.className = "cust-wrap";
    const reihe = document.createElement("div");
    reihe.className = "cust-row";
    el.name.replaceWith(wrap);
    reihe.appendChild(el.name);
    reihe.appendChild(st.nearBtn);
    wrap.appendChild(reihe);
    wrap.appendChild(st.box);
    SpeckmannStandort.hideList();
    el.name.addEventListener("input", () => SpeckmannStandort.hideList());
    ksStandortPick = (k) => { const c = ksKunden[custKey(k.name)] || k; waehle(c); };
  }

  // Fokus im Feld halten, wenn die Liste angetippt wird (wichtig fürs iPhone)
  liste.addEventListener("mousedown", (e) => e.preventDefault());
  liste.addEventListener("touchstart", () => clearTimeout(blurTimer), { passive: true });
  el.name.addEventListener("input", () => {
    const key = custKey(el.name.value);
    // Name von Hand geändert: Adresse im Feld gehört dann nicht mehr automatisch zum neuen Namen
    const known = ksKunden[key];
    if (known && besitzer !== key) { setzeAdresse(known.address || ""); besitzer = key; }
    else if (!known && besitzer && ksKunden[besitzer]) { setzeAdresse(""); besitzer = null; }
    if (obj.baustelleId && obj.baustelleKunde !== key) waehleBaustelle(null);
    zeichne();
    aktualisiereAdressfeld();
    renderBaustellen();
  });
  el.name.addEventListener("focus", zeichne);
  el.name.addEventListener("blur", () => { blurTimer = setTimeout(schliesse, 250); });

  aktualisiereAdressfeld();
  renderBaustellen();
}

/* ---------- Standort-Funktionen einmalig anlegen (v7.2) ---------- */

let ksStandort = null;
let ksStandortPick = null;
function ksStandortTeile() {
  if (!window.SpeckmannStandort) return null;
  if (ksStandort) return ksStandort;
  const nearBtn = document.createElement("button");
  nearBtn.type = "button";
  nearBtn.className = "near-btn";
  nearBtn.id = "nearCustBtn";
  nearBtn.title = "Kunde in der Nähe";
  nearBtn.setAttribute("aria-label", "Kunde in der Nähe suchen");
  nearBtn.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-pin"/></svg>`;
  const box = document.createElement("div");
  box.className = "suggest";
  box.id = "nearCustSuggest";
  ksStandort = { nearBtn, box };
  SpeckmannStandort.init({
    getCustomers: () => Object.values(ksKunden),
    onPick: (k) => { if (ksStandortPick) ksStandortPick(k); },
    nearButton: nearBtn,
    suggestBox: box,
    toast: (text, ms) => ksToast(text, ms)
  });
  // Tippen in der Liste soll nicht das Kundenfeld (umgebendes label) fokussieren
  box.addEventListener("click", (e) => e.preventDefault());
  // normale Namensvorschläge ausblenden, wenn „in der Nähe“ gesucht wird
  nearBtn.addEventListener("click", () => document.querySelectorAll(".ks-liste").forEach((l) => { l.hidden = true; l.innerHTML = ""; }));
  // Liste schließen, wenn außerhalb getippt wird
  document.addEventListener("click", (e) => {
    if (box.classList.contains("show") && !e.target.closest(".cust-wrap")) SpeckmannStandort.hideList();
  });
  return ksStandort;
}

let ksToastTimer = null;
function ksToast(text, dauer) {
  let t = document.getElementById("ksToast");
  if (!t) { t = document.createElement("div"); t.id = "ksToast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = text;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(ksToastTimer);
  ksToastTimer = setTimeout(() => t.classList.remove("show"), dauer || 4000);
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
