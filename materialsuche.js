"use strict";

/* ============================================================
   Aufmaßsoftware – einheitliche Materialsuche
   Ersetzt die fünf Reiter (Favoriten / Aus Liste / Standardmaterial /
   Freitext / Diktat) durch EIN Suchfeld mit 📷 Scannen und 🎤 Diktat.
   Treffer gruppiert: 📁 Baustelle → ⭐ Favoriten → Meine Datenbank →
   Großhandelskatalog → Freitext. Ein Tipp fügt Menge 1 hinzu; die Menge
   wird in der Leiste unten angepasst (oder ↶ rückgängig).
   Material aus Katalog/Freitext/unbekannter EAN legt sich automatisch in
   der Datenbank ab (im Baustellen-Ordner, sonst „Eigene Artikel“).
   Wird nach app.js geladen.
   ============================================================ */

const MS_EINHEITEN = ["Stck", "m", "Rolle", "Pack", "Satz", "Paar", "kg", "VE"];
let msZustand = null; // { material, fertig }

function msEl(id) { return document.getElementById(id); }

/* `material`: Array, in das hinzugefügt wird; `onHinzufuegen`: Neuzeichnen + Speichern beim Aufrufer */
function bindeMaterialAuswahl(material, onHinzufuegen, optionen) {
  if (typeof aktualisiereAbgeleiteteListen === "function") aktualisiereAbgeleiteteListen();
  const fertig = () => {
    if (typeof loeseKombisAuf === "function") loeseKombisAuf(material);
    onHinzufuegen();
  };
  msZustand = { material, fertig };
  msSnackAus();
  const suche = msEl("ms_suche");
  const erg = msEl("ms_ergebnis");
  if (!suche || !erg) return;

  // Diktat (nur Aufmaß / Packliste)
  const dBtn = msEl("ms_diktatBtn");
  const dPanel = msEl("ms_diktat");
  if (optionen && optionen.diktat && typeof bindeMaterialDiktat === "function") {
    dBtn.hidden = false;
    bindeMaterialDiktat(material, fertig);
    dBtn.addEventListener("click", () => {
      dPanel.hidden = !dPanel.hidden;
      dBtn.classList.toggle("aktiv", !dPanel.hidden);
      if (!dPanel.hidden) msEl("md_text").focus();
    });
  }

  let timer = null;
  suche.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => msRender(suche.value), 150); });
  suche.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const erste = erg.querySelector(".ms-zeile");
    if (erste) erste.click();
  });
  msEl("ms_scan").addEventListener("click", () => oeffneBarcodeScanner((roh) => msNachScan(roh)));
  if (typeof materialDBListener !== "undefined") {
    const l = () => {
      if (!document.body.contains(suche)) { materialDBListener.delete(l); return; }
      if (suche.value.trim().length >= 2) msRender(suche.value);
    };
    materialDBListener.add(l);
  }
  msRender("");
}

/* ---------- Treffer sammeln ---------- */

function msAusDb(m, quelle) {
  return {
    quelle, dbId: m.id, name: m.name, nr: m.nr || "", ean: m.ean || "", einheit: m.einheit || "Stck",
    kombi: typeof istKombi === "function" && istKombi(m),
    info: (typeof istKombi === "function" && istKombi(m)) ? "Kombination: " + kombiBeschreibung(m)
      : [m.ordner ? "📁 " + ordnerName(m.ordner) : kategorieName(m.kat), m.nr && "Art.-Nr. " + m.nr, m.einheit || "Stck"].filter(Boolean).join(" · "),
    stern: sternDatenFuerDb(m)
  };
}

function msAusKatalog(a) {
  return {
    quelle: "katalog", name: a.b, nr: a.n || "", ean: a.g || "", einheit: a.e || "Stck",
    info: ["Großhandel", a.n && "Art.-Nr. " + a.n, a.e].filter(Boolean).join(" · "),
    stern: sternDatenFuerKatalog(a)
  };
}

function msNutzungDb(m) { return nutzung("standard:" + m.name); }

function msSortiere(liste) {
  return liste.sort((a, b) => msNutzungDb(b) - msNutzungDb(a) || a.name.localeCompare(b.name, "de"));
}

function msPasst(worte, text) {
  const t = text.toLowerCase();
  return worte.every((w) => t.includes(w));
}

function msSammle(q) {
  const worte = q.toLowerCase().split(/\s+/).filter(Boolean);
  const ordnerId = typeof aktiverOrdnerId === "function" ? aktiverOrdnerId() : "";
  const sichtbar = dbMaterial.filter((m) => (typeof imKontextSichtbar !== "function" || imKontextSichtbar(m)));
  const gruppen = [];
  const gezeigt = new Set();
  const merke = (e) => { const k = (e.name + "|" + e.nr).toLowerCase(); if (gezeigt.has(k)) return false; gezeigt.add(k); return true; };
  const dbText = (m) => m.name + " " + (m.nr || "") + " " + (m.ean || "") + " " + kategorieName(m.kat) + (istKombi(m) ? " " + kombiBeschreibung(m) : "");

  // 📁 Baustelle
  if (ordnerId) {
    let l = sichtbar.filter((m) => m.ordner === ordnerId);
    if (worte.length) l = l.filter((m) => msPasst(worte, dbText(m)));
    const eintraege = msSortiere(l).map((m) => msAusDb(m, "db")).filter(merke);
    if (eintraege.length) gruppen.push({ key: "baustelle", titel: "📁 " + ordnerName(ordnerId), eintraege });
  }
  // ⭐ Favoriten
  {
    const favs = [];
    for (const f of topFavoriten()) {
      if (worte.length && !msPasst(worte, f.bezeichnung + " " + (f.artikelnummer || ""))) continue;
      const m = sichtbar.find((x) => x.name === f.bezeichnung);
      let e;
      if (m) e = msAusDb(m, "db");
      else if (f.quelle === "liste") e = { quelle: "katalog", name: f.bezeichnung, nr: f.artikelnummer || "", ean: "", einheit: f.einheit || "Stck", info: ["Großhandel", f.artikelnummer && "Art.-Nr. " + f.artikelnummer, f.einheit].filter(Boolean).join(" · "), stern: { key: f.key, ...f } };
      else if (!dbMaterial.some((x) => x.name === f.bezeichnung)) e = { quelle: "frei", name: f.bezeichnung, nr: f.artikelnummer || "", ean: "", einheit: f.einheit || "Stck", info: f.einheit || "Stck", stern: { key: f.key, ...f } };
      else continue; // gehört zu einem anderen Baustellen-Ordner
      if (merke(e)) favs.push(e);
      if (favs.length >= (worte.length ? 10 : 15)) break;
    }
    if (favs.length) gruppen.push({ key: "favoriten", titel: "⭐ Favoriten", eintraege: favs });
  }
  if (!worte.length) {
    // Häufig benutzt (ohne Stern)
    const haeufig = Object.entries(favoritenCounts)
      .filter(([key]) => !istStern(key))
      .sort((a, b) => b[1].count - a[1].count)
      .map(([, d]) => {
        const m = sichtbar.find((x) => x.name === d.bezeichnung);
        if (m) return msAusDb(m, "db");
        if (d.quelle === "liste") return { quelle: "katalog", name: d.bezeichnung, nr: d.artikelnummer || "", ean: "", einheit: d.einheit || "Stck", info: ["Großhandel", d.artikelnummer && "Art.-Nr. " + d.artikelnummer].filter(Boolean).join(" · "), stern: { key: "liste:" + d.artikelnummer, quelle: "liste", artikelnummer: d.artikelnummer, bezeichnung: d.bezeichnung, einheit: d.einheit } };
        return null;
      })
      .filter(Boolean).filter(merke).slice(0, 8);
    if (haeufig.length) gruppen.push({ key: "haeufig", titel: "🕘 Häufig benutzt", eintraege: haeufig });
    return { gruppen, worte };
  }
  // Meine Datenbank
  {
    const l = msSortiere(sichtbar.filter((m) => !m.ordner && msPasst(worte, dbText(m))));
    const eintraege = l.map((m) => msAusDb(m, "db")).filter(merke);
    if (eintraege.length) gruppen.push({ key: "db", titel: "🗂 Meine Datenbank", eintraege: eintraege.slice(0, 25), mehr: Math.max(0, eintraege.length - 25) });
  }
  // Großhandelskatalog
  if (q.trim().length >= 2) {
    if (typeof materialDBReady !== "undefined" && !materialDBReady) {
      gruppen.push({ key: "katalog", titel: "🏭 Großhandelskatalog", eintraege: [], hinweis: materialDBFehler || materialDBStatus });
    } else {
      const kat = sucheMaterial(q, 40).filter((a) => !a._eigen).map(msAusKatalog).filter(merke).slice(0, 20);
      if (kat.length) gruppen.push({ key: "katalog", titel: "🏭 Großhandelskatalog", eintraege: kat });
    }
  }
  return { gruppen, worte };
}

/* ---------- Anzeige ---------- */

function msRender(q) {
  const erg = msEl("ms_ergebnis");
  if (!erg) return;
  const text = (q || "").trim();
  const { gruppen } = msSammle(text);
  erg.innerHTML = "";
  // Gruppen zum Aufklappen. Ohne Suchtext: nur der Baustellen-Ordner offen (Zustand wird gemerkt),
  // mit Suchtext: alle Treffer offen.
  let offen = {};
  try { offen = JSON.parse(localStorage.getItem("am2_ms_offen") || "{}") || {}; } catch (e) { offen = {}; }
  for (const g of gruppen) {
    const det = document.createElement("details");
    det.className = "ms-gruppe-det";
    det.open = text ? true : (g.key in offen ? !!offen[g.key] : g.key === "baustelle");
    const sum = document.createElement("summary");
    sum.className = "ms-gruppe";
    sum.textContent = g.titel + (g.eintraege.length ? ` (${g.eintraege.length}${g.mehr ? "+" : ""})` : "");
    det.appendChild(sum);
    if (!text) det.addEventListener("toggle", () => {
      offen[g.key] = det.open;
      try { localStorage.setItem("am2_ms_offen", JSON.stringify(offen)); } catch (e) { /* egal */ }
    });
    if (g.hinweis) {
      const p = document.createElement("p");
      p.className = "hint ms-hinweis";
      p.textContent = g.hinweis;
      det.appendChild(p);
    }
    const ul = document.createElement("ul");
    ul.className = "ms-liste";
    for (const e of g.eintraege) ul.appendChild(msZeile(e));
    if (g.eintraege.length) det.appendChild(ul);
    if (g.mehr) {
      const p = document.createElement("p");
      p.className = "hint ms-hinweis";
      p.textContent = `… und ${g.mehr} weitere – Suche genauer eingeben.`;
      det.appendChild(p);
    }
    erg.appendChild(det);
  }
  if (text) {
    if (istEanAehnlich(text) && !gruppen.some((g) => g.eintraege.length)) erg.appendChild(msEanNeuZeile(text));
    erg.appendChild(msFreiZeile(text));
  } else if (!gruppen.length) {
    const p = document.createElement("p");
    p.className = "hint ms-hinweis";
    p.textContent = "Tippen zum Suchen – Treffer kommen aus Baustellen-Ordner, Favoriten, deiner Datenbank und dem Großhandelskatalog. 📷 scannt eine EAN.";
    erg.appendChild(p);
  }
}

function msZeile(e) {
  const li = document.createElement("li");
  li.className = "ms-zeile" + (e.quelle === "katalog" ? " katalog" : "");
  li.innerHTML = `<div class="ms-text"><strong></strong><small></small></div>
    <button type="button" class="stern-btn" aria-label="Favorit"></button>
    <span class="ms-plus" aria-hidden="true">＋</span>`;
  li.querySelector("strong").textContent = e.name;
  li.querySelector("small").textContent = e.info;
  if (e.stern) bindeSternKnopf(li.querySelector(".stern-btn"), e.stern, () => {});
  else li.querySelector(".stern-btn").remove();
  li.addEventListener("click", (ev) => {
    if (ev.target.closest(".ms-menge")) return;
    msOeffneMenge(li, e);
  });
  return li;
}

/* Mengenfeld direkt unter dem angetippten Eintrag: Menge wählen → „Hinzufügen“ */
function msOeffneMenge(zeile, e, mitEinheitWahl) {
  document.querySelectorAll(".ms-menge").forEach((x) => { const z = x.closest(".ms-zeile, .ms-frei"); x.remove(); if (z) z.classList.remove("offen"); });
  zeile.classList.add("offen");
  const box = document.createElement("div");
  box.className = "ms-menge";
  const einheitHtml = mitEinheitWahl
    ? `<select class="ms-menge-einheit">${MS_EINHEITEN.map((x) => `<option${x === e.einheit ? " selected" : ""}>${x}</option>`).join("")}</select>`
    : `<span class="ms-menge-einheit-text"></span>`;
  box.innerHTML = `
    <div class="ms-menge-zeile">
      <button type="button" class="btn-qty" data-a="minus" aria-label="weniger">−</button>
      <input type="number" class="ms-menge-input" step="any" min="0" inputmode="decimal" value="1">
      <button type="button" class="btn-qty" data-a="plus" aria-label="mehr">＋</button>
      ${einheitHtml}
    </div>
    <div class="ms-menge-aktionen">
      <button type="button" class="btn btn-primary ms-menge-ok">Hinzufügen</button>
      <button type="button" class="btn-danger-text ms-menge-ab">Abbrechen</button>
    </div>`;
  if (!mitEinheitWahl) box.querySelector(".ms-menge-einheit-text").textContent = e.einheit || "Stck";
  const inp = box.querySelector(".ms-menge-input");
  const wert = () => { const v = parseFloat(String(inp.value).replace(",", ".")); return isNaN(v) ? 0 : v; };
  box.querySelector('[data-a="minus"]').addEventListener("click", () => { inp.value = Math.max(0, rundeMenge(wert() - 1)); });
  box.querySelector('[data-a="plus"]').addEventListener("click", () => { inp.value = rundeMenge(wert() + 1); });
  const ok = () => {
    const menge = wert();
    if (!(menge > 0)) { inp.focus(); return; }
    const eintrag = mitEinheitWahl ? { ...e, einheit: box.querySelector(".ms-menge-einheit").value } : e;
    msHinzufuegen(eintrag, menge);
  };
  box.querySelector(".ms-menge-ok").addEventListener("click", ok);
  inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); ok(); } });
  box.querySelector(".ms-menge-ab").addEventListener("click", () => { box.remove(); zeile.classList.remove("offen"); });
  zeile.appendChild(box);
  setTimeout(() => { inp.focus(); inp.select(); box.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 30);
}

function msFreiZeile(text) {
  const li = document.createElement("div");
  li.className = "ms-frei";
  li.innerHTML = `<span class="ms-frei-text"></span><span class="ms-plus" aria-hidden="true">＋</span>`;
  li.querySelector(".ms-frei-text").textContent = `✎ „${text}“ als eigenes Material`;
  const einheit = /\b(nym|kabel|leitung|rohr|kanal|stripe|streifen|band|draht|litze)\b/i.test(text) ? "m" : "Stck";
  li.addEventListener("click", (ev) => {
    if (ev.target.closest(".ms-menge")) return;
    msOeffneMenge(li, { quelle: "frei", name: text, nr: "", ean: "", einheit }, true);
  });
  return li;
}

function msEanNeuZeile(code) {
  const li = document.createElement("div");
  li.className = "ms-frei ms-ean";
  li.innerHTML = `<span class="ms-frei-text"></span><button type="button" class="btn btn-secondary">Anlegen</button>`;
  li.querySelector(".ms-frei-text").textContent = `EAN ${code} unbekannt – neuen Artikel anlegen`;
  li.querySelector("button").addEventListener("click", () => msEanNeu(code));
  return li;
}

function msEanNeu(code) {
  const name = (prompt(`Bezeichnung für EAN ${code}:`) || "").trim();
  if (!name) return;
  const zeile = document.querySelector(".ms-ean");
  if (zeile) msOeffneMenge(zeile, { quelle: "frei", name, nr: "", ean: code, einheit: "Stck" }, true);
}

/* ---------- Scannen ---------- */

function msNachScan(roh) {
  const code = String(roh || "").trim();
  const suche = msEl("ms_suche");
  if (!code || !suche) return;
  suche.value = code;
  // exakter Treffer in der eigenen Datenbank (sichtbar) -> direkt hinzufügen
  const m = dbMaterial.find((x) => imKontextSichtbar(x) && ((x.ean && eanVarianten(code).includes(x.ean)) || x.ean === code || x.nr === code));
  msRender(code);
  // eindeutiger Treffer: Mengenfeld gleich öffnen
  const zeilen = document.querySelectorAll("#ms_ergebnis .ms-zeile");
  if (m || zeilen.length === 1) { if (zeilen[0]) zeilen[0].click(); }
}

/* ---------- Hinzufügen ---------- */

function msHinzufuegen(e, menge) {
  if (!msZustand) return;
  const { material, fertig } = msZustand;
  const ordnerId = typeof aktiverOrdnerId === "function" ? aktiverOrdnerId() : "";
  let name = e.name, nr = e.nr || "", einheit = e.einheit || "Stck";
  // Automatisch in der Datenbank ablegen (Katalog / eigenes Material / neue EAN)
  if (e.quelle === "katalog" || e.quelle === "frei") {
    const m = dbNeu({ kat: KAT_EIGENE, name, nr, ean: e.ean || "", einheit, ordner: ordnerId });
    if (m) { name = m.name; nr = m.nr || ""; einheit = m.einheit || einheit; }
  }
  registriereFavoritTreffer("standard", "", name, einheit);

  const istKombination = !!e.kombi;
  let zeile = istKombination ? null : material.find((x) => !String(x.id).includes("~") && !x.erledigt &&
    x.bezeichnung === name && (x.artikelnummer || "") === nr && x.einheit === einheit);
  let neu = false;
  const vorher = zeile ? zeile.menge : 0;
  if (zeile) zeile.menge = rundeMenge((zeile.menge || 0) + menge);
  else {
    zeile = { id: neueId(), bezeichnung: name, artikelnummer: nr, einheit, menge, quelle: e.quelle === "katalog" ? "liste" : "standard", erledigt: false };
    material.push(zeile);
    neu = true;
  }
  const id = zeile.id;
  fertig();
  const suche = msEl("ms_suche");
  if (suche) suche.value = "";
  msRender("");
  const mengeText = String(menge).replace(".", ",");
  msBestaetigung(
    istKombination ? `✓ ${mengeText}× ${name} – Teile einzeln eingetragen` : `✓ ${mengeText} ${einheit} ${name} hinzugefügt${neu ? "" : ` (jetzt ${String(zeile.menge).replace(".", ",")} ${einheit})`}`,
    () => {
      if (neu) {
        for (let i = material.length - 1; i >= 0; i--) if (String(material[i].id).split("~")[0] === id) material.splice(i, 1);
      } else if (zeile) zeile.menge = vorher;
      fertig();
    });
}

/* Bestätigung direkt unter dem Suchfeld (bleibt, bis das nächste Material kommt) */
function msBestaetigung(text, rueckgaengig) {
  const kopf = document.querySelector(".ms-kopf");
  if (!kopf) return;
  let el = document.getElementById("ms_ok");
  if (!el) {
    el = document.createElement("div");
    el.id = "ms_ok";
    el.className = "ms-ok";
    kopf.after(el);
  }
  el.innerHTML = `<span></span><button type="button" class="btn-link-accent">↶ Rückgängig</button>`;
  el.querySelector("span").textContent = text;
  el.querySelector("button").addEventListener("click", () => { rueckgaengig(); el.remove(); });
  el.hidden = false;
}

/* ---------- (alte schwebende Leiste, nur noch zum Ausblenden) ---------- */

let msSnackTimer = null;

function msSnackAus() {
  clearTimeout(msSnackTimer);
  const el = document.getElementById("msSnack");
  if (el) el.hidden = true;
}
